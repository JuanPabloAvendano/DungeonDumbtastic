"""Traductor local inglés → español para el compendio (sin internet ni servicios externos).

Proceso que se queda vivo: lee por stdin líneas JSON {"id": n, "texts": [...]} y responde por stdout
{"id": n, "out": [...]}. Usa el modelo de Argos (CTranslate2 + SentencePiece) y una capa de términos
de juego: las expresiones de reglas se protegen antes de traducir y se ponen en su español correcto
después («Dexterity saving throw» → «tirada de salvación de Destreza», «8d6 fire damage» → «8d6 de
daño de fuego»). Las líneas de bloque de estadísticas se traducen solo con reglas.

Uso: venv/bin/python traducir.py <carpeta del modelo en_es>
"""
import json
import re
import sys

import os

import ctranslate2
import sentencepiece as spm

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nombres import known_title  # noqa: E402

BEAM = 2
BATCH = 32
MAX_SENTENCE_CHARS = 600

ABILITY = {'strength': 'Fuerza', 'dexterity': 'Destreza', 'constitution': 'Constitución',
           'intelligence': 'Inteligencia', 'wisdom': 'Sabiduría', 'charisma': 'Carisma'}
# Como se dice el tipo detrás de «daño»: unos son adjetivos (cortante) y otros van con «de» (de fuego).
DAMAGE = {'acid': 'de ácido', 'bludgeoning': 'contundente', 'cold': 'de frío', 'fire': 'de fuego', 'force': 'de fuerza',
          'lightning': 'de relámpago', 'necrotic': 'necrótico', 'piercing': 'perforante', 'poison': 'de veneno',
          'psychic': 'psíquico', 'radiant': 'radiante', 'slashing': 'cortante', 'thunder': 'de trueno'}
CONDITIONS = {'blinded': 'cegado', 'charmed': 'hechizado', 'deafened': 'ensordecido', 'frightened': 'asustado',
              'grappled': 'agarrado', 'incapacitated': 'incapacitado', 'paralyzed': 'paralizado',
              'petrified': 'petrificado', 'poisoned': 'envenenado', 'prone': 'derribado', 'restrained': 'apresado',
              'stunned': 'aturdido', 'unconscious': 'inconsciente', 'exhaustion': 'agotamiento'}
ACTIONS = {'Dash': 'Correr', 'Disengage': 'Destrabarse', 'Dodge': 'Esquivar', 'Help': 'Ayudar', 'Hide': 'Esconderse',
           'Ready': 'Preparar', 'Search': 'Buscar', 'Use an Object': 'Usar un objeto'}
SCHOOLS = {'abjuration': 'abjuración', 'conjuration': 'conjuración', 'divination': 'adivinación',
           'enchantment': 'encantamiento', 'evocation': 'evocación', 'illusion': 'ilusión',
           'necromancy': 'nigromancia', 'transmutation': 'transmutación'}
SHAPES = {'sphere': 'esfera', 'cube': 'cubo', 'cone': 'cono', 'line': 'línea', 'cylinder': 'cilindro',
          'circle': 'círculo', 'square': 'cuadrado', 'radius': 'radio', 'emanation': 'emanación'}
SIZES = {'Tiny': 'Diminuto', 'Small': 'Pequeño', 'Medium': 'Mediano', 'Large': 'Grande', 'Huge': 'Enorme',
         'Gargantuan': 'Gargantuesco'}
TIME_UNITS = {'action': 'acción', 'actions': 'acciones', 'bonus action': 'acción adicional', 'reaction': 'reacción',
              'minute': 'minuto', 'minutes': 'minutos', 'hour': 'hora', 'hours': 'horas', 'round': 'asalto',
              'rounds': 'asaltos', 'day': 'día', 'days': 'días', 'turn': 'turno'}
SKILLS = {'Acrobatics': 'Acrobacias', 'Animal Handling': 'Trato con animales', 'Arcana': 'Arcanos', 'Athletics': 'Atletismo',
          'Deception': 'Engaño', 'History': 'Historia', 'Insight': 'Perspicacia', 'Intimidation': 'Intimidación',
          'Investigation': 'Investigación', 'Medicine': 'Medicina', 'Nature': 'Naturaleza', 'Perception': 'Percepción',
          'Performance': 'Interpretación', 'Persuasion': 'Persuasión', 'Religion': 'Religión', 'Sleight of Hand': 'Juego de manos',
          'Stealth': 'Sigilo', 'Survival': 'Supervivencia'}
CREATURE_TYPES = {'aberration': 'aberración', 'beast': 'bestia', 'celestial': 'celestial', 'construct': 'constructo',
                  'dragon': 'dragón', 'elemental': 'elemental', 'fey': 'feérico', 'fiend': 'infernal', 'giant': 'gigante',
                  'humanoid': 'humanoide', 'monstrosity': 'monstruosidad', 'ooze': 'cieno', 'plant': 'planta', 'undead': 'no muerto',
                  'swarm': 'enjambre'}
ALIGNMENTS = [('lawful good', 'legal bueno'), ('neutral good', 'neutral bueno'), ('chaotic good', 'caótico bueno'),
              ('lawful neutral', 'legal neutral'), ('chaotic neutral', 'caótico neutral'), ('lawful evil', 'legal malvado'),
              ('neutral evil', 'neutral malvado'), ('chaotic evil', 'caótico malvado'), ('unaligned', 'sin alineamiento'),
              ('any alignment', 'cualquier alineamiento'), ('any evil alignment', 'cualquier alineamiento malvado'),
              ('any non-good alignment', 'cualquier alineamiento no bueno'), ('any non-lawful alignment', 'cualquier alineamiento no legal')]
LANGUAGES = {'Common': 'Común', 'Elvish': 'Élfico', 'Dwarvish': 'Enano', 'Draconic': 'Dracónico', 'Abyssal': 'Abisal',
             'Undercommon': 'Infracomún', 'Sylvan': 'Silvano', 'Giant': 'Gigante', 'Gnomish': 'Gnomo', 'Halfling': 'Mediano',
             'Orc': 'Orco', 'Deep Speech': 'Habla profunda', 'telepathy': 'telepatía', 'understands': 'entiende', 'but': 'pero',
             "can't speak": 'no puede hablar', 'any languages it knew in life': 'los idiomas que conocía en vida'}
MOVES = {'fly': 'volando', 'swim': 'nadando', 'climb': 'trepando', 'burrow': 'excavando'}

ORD = r'(\d+)(?:st|nd|rd|th)'
DICE = r'\d+d\d+(?:\s*[+-]\s*\d+)?'
DMG_TYPES = '|'.join(DAMAGE)
ABILITIES = '|'.join(ABILITY)
COND_WORDS = '|'.join(CONDITIONS)


def same_case(original, word):
    return word[0].upper() + word[1:] if original[:1].isupper() else word


def ability_es(word):
    return ABILITY[word.lower()]


# Reglas (inglés → español ya hecho) que se protegen con un marcador antes de pasar por el modelo.
# Van de las más largas a las más cortas para que no se pisen. (patrón, sustitución, ignorar mayúsculas)
PROTECT_RULES = [
    (rf'\b({ABILITIES}) saving throws?\b', lambda m: f'tirada de salvación de {ability_es(m[1])}', True),
    (rf'\b({ABILITIES}) \(([A-Z][a-z]+(?: [A-Z][a-z]+)*)\) checks?\b', lambda m: f'prueba de {ability_es(m[1])} ({m[2]})', True),
    (rf'\b({ABILITIES}) checks?\b', lambda m: f'prueba de {ability_es(m[1])}', True),
    (rf'\b({ABILITIES}) modifier\b', lambda m: f'modificador de {ability_es(m[1])}', True),
    (rf'\b({ABILITIES}) scores?\b', lambda m: f'puntuación de {ability_es(m[1])}', True),
    (r'\bon a failed save\b', lambda m: 'si falla la salvación', True),
    (r'\bon a successful (?:one|save)\b', lambda m: 'si la supera', True),
    (r'\bsaving throws?\b', lambda m: 'tirada de salvación', True),
    (r'\bability checks?\b', lambda m: 'prueba de característica', True),
    (r'\b(ranged|melee) spell attacks?\b', lambda m: 'ataque de conjuro ' + ('a distancia' if m[1].lower() == 'ranged' else 'cuerpo a cuerpo'), True),
    (r'\battack rolls?\b', lambda m: 'tirada de ataque', True),
    (r'\bspell slots?\b', lambda m: 'espacio de conjuro', True),
    (r'\bslot level\b', lambda m: 'nivel del espacio', True),
    (r'\btemporary hit points\b', lambda m: 'puntos de golpe temporales', True),
    (r'\bhit points?\b', lambda m: 'puntos de golpe', True),
    (r'\bhit dice\b', lambda m: 'dados de golpe', True),
    (r'\bArmor Class\b', lambda m: 'Clase de Armadura', False),
    (r'\bproficiency bonus\b', lambda m: 'bonificador por competencia', True),
    (r'\bspellcasting ability modifier\b', lambda m: 'modificador por característica para lanzar conjuros', True),
    (r'\bspellcasting ability\b', lambda m: 'característica para lanzar conjuros', True),
    (r'\bspell save DC\b', lambda m: 'CD de salvación de conjuros', True),
    (r'\b(short|long) rest\b', lambda m: 'descanso ' + ('corto' if m[1].lower() == 'short' else 'largo'), True),
    (r'\bbonus actions?\b', lambda m: 'acción adicional', True),
    (r'\bopportunity attacks?\b', lambda m: 'ataque de oportunidad', True),
    (r'\bdarkvision\b', lambda m: 'visión en la oscuridad', True),
    (r'\bcantrips?\b', lambda m: 'truco', True),
    (r'\bdisadvantage\b', lambda m: 'desventaja', True),
    (r'\badvantage\b', lambda m: 'ventaja', True),
    (rf'(?:\b(\d+) )?\(?({DICE})\)?\s+({DMG_TYPES}) damage\b',
     lambda m: f'{m[1] + " (" + m[2] + ")" if m[1] else m[2]} de daño {DAMAGE[m[3].lower()]}', True),
    (rf'(?:\b(\d+) )?\(({DICE})\) damage\b', lambda m: f'{(m[1] + " ") if m[1] else ""}({m[2]}) de daño', True),
    (rf'\b({DMG_TYPES}) damage\b', lambda m: f'daño {DAMAGE[m[1].lower()]}', True),
    (r'\b(\d+)-foot-radius (sphere|circle|cylinder|emanation)\b', lambda m: f'{SHAPES[m[2].lower()]} de {m[1]} pies de radio', True),
    (r'\b(\d+)-foot (cube|cone|line|square|radius|sphere)\b', lambda m: f'{SHAPES[m[2].lower()]} de {m[1]} pies', True),
    (r'\b(\d+)-foot\b', lambda m: f'de {m[1]} pies', True),
    (r'\b(\d+) feet\b', lambda m: f'{m[1]} pies', True),
    (r'\b(\d+)\s?ft\.', lambda m: f'{m[1]} pies', True),
    (r'\bthe (Dash|Disengage|Dodge|Help|Hide|Ready|Search) or (Dash|Disengage|Dodge|Help|Hide|Ready|Search) action\b',
     lambda m: f'la acción de {ACTIONS[m[1]]} o {ACTIONS[m[2]]}', False),
    # Nombres de criatura que el modelo confunde («duende», «golem»): se quedan con su mayúscula.
    (r'\bgolems?\b', lambda m: same_case(m[0], 'gólems' if m[0].lower().endswith('s') else 'gólem'), True),
    (r'\b(' + '|'.join(SKILLS) + r')\b', lambda m: SKILLS[m[1]], False),
    (r'\bXP\b', lambda m: 'PX', False),
    (rf'\b{ORD}[ -]level\b', lambda m: f'de nivel {m[1]}', True),
    (r'\bthe (Dash|Disengage|Dodge|Help|Hide|Ready|Search|Use an Object) action\b', lambda m: f'la acción de {ACTIONS[m[1]]}', False),
    (rf'\b({COND_WORDS})\b', lambda m: CONDITIONS[m[1].lower()], True),
    # Las características sueltas solo con mayúscula («Dexterity»), para no tocar «strength» de prosa.
    (r'\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\b', lambda m: ability_es(m[1]), False),
]
PROTECT = [(re.compile(p, re.I if ci else 0), fn) for p, fn, ci in PROTECT_RULES]

# Correcciones del español del modelo (lo que no se pudo proteger antes).
POST = [(re.compile(p), r) for p, r in [
    (r'\bhechizos\b', 'conjuros'), (r'\bhechizo\b', 'conjuro'), (r'\bHechizo\b', 'Conjuro'),
    (r'\bdentro del rango\b', 'dentro del alcance'), (r'\bel rango\b', 'el alcance'), (r'\bRango\b', 'Alcance'),
    (r'\bacciones? de bonificación\b', 'acción adicional'), (r'\bduendes\b', 'goblins'), (r'\bduende\b', 'goblin'),
    (r'\bDuendes\b', 'Goblins'), (r'\bDuende\b', 'Goblin'),
    (r'\b(toma|lleva|sufre|tiene) (?=\d+d\d+ de daño)', 'recibe '), (r'\b(toman|llevan|sufren) (?=\d+d\d+ de daño)', 'reciben '),
    # Los términos de juego femeninos llegan con artículo masculino («un tirada», «el esfera»).
    (r'\b([Uu])n (tirada|prueba|esfera|línea|acción|puntuación|CD|ventaja|desventaja|salvación)\b', r'\1na \2'),
    (r'\b([Ee])l (tirada|prueba|esfera|línea|acción|puntuación|CD|salvación)\b', lambda m: ('L' if m[1] == 'E' else 'l') + 'a ' + m[2]),
    (r'\b(esfera|línea|tirada) (de \d+ pies(?: de radio)?) centrado\b', r'\1 \2 centrada'),
    (r'\b(\d+)(?:st|nd|rd|th|to|er|o|a)\b', r'\1.º'), (r'\bde de\b', 'de'), (r' +([.,;:)])', r'\1'), (r'\( +', '('), (r'  +', ' '),
]]

# Líneas de bloque de estadísticas / cabeceras de conjuro: se traducen solo con reglas.
FIELD = [(re.compile(p, re.I), f) for p, f in [
    (r'^Casting Tim\s*e:\s*(.*)$', 'Tiempo de lanzamiento: {}'), (r'^Range:\s*(.*)$', 'Alcance: {}'),
    (r'^Com\s*ponents:\s*(.*)$', 'Componentes: {}'), (r'^Duration:\s*(.*)$', 'Duración: {}'),
    (r'^Armor Class\s*(.*)$', 'Clase de Armadura {}'), (r'^Hit Points\s*(.*)$', 'Puntos de golpe {}'),
    (r'^Speed\s*(.*)$', 'Velocidad {}'), (r'^Saving Throws\s*(.*)$', 'Tiradas de salvación {}'),
    (r'^Skills\s*(.*)$', 'Habilidades {}'), (r'^Senses\s*(.*)$', 'Sentidos {}'), (r'^Languages\s*(.*)$', 'Idiomas {}'),
    (r'^Challenge\s*(.*)$', 'Desafío {}'), (r'^Damage Resistances\s*(.*)$', 'Resistencias al daño {}'),
    (r'^Damage Immunities\s*(.*)$', 'Inmunidades al daño {}'), (r'^Damage Vulnerabilities\s*(.*)$', 'Vulnerabilidades al daño {}'),
    (r'^Condition Immunities\s*(.*)$', 'Inmunidades a estados {}'),
]]
HEADINGS = {'ACTIONS': 'ACCIONES', 'REACTIONS': 'REACCIONES', 'LEGENDARY ACTIONS': 'ACCIONES LEGENDARIAS',
            'LAIR ACTIONS': 'ACCIONES DE GUARIDA', 'STR DEX CON INT WIS CHA': 'FUE DES CON INT SAB CAR'}
# Tiempo de lanzamiento / alcance / duración largos («1 reaction, which you take when…»): el valor va al modelo.
LONG_FIELD_RE = re.compile(r'^(Casting Tim\s*e|Range|Duration):\s*(.{28,})$', re.I)
MATERIAL_RE = re.compile(r'^Com\s*ponents:\s*([^(]*)\((.+)\)\s*$', re.I)
ATTACK_RE = re.compile(r'(Melee or Ranged|Melee|Ranged) (Weapon|Spell) Attack:\s*\+\s*(\d+) to hit,?\s*')
ATTACK_ES = {'Melee': 'cuerpo a cuerpo', 'Ranged': 'a distancia', 'Melee or Ranged': 'cuerpo a cuerpo o a distancia'}


def field_value(v):
    """Valores cortos de cabecera: «1 action», «Self», «Concentration, up to 1 minute», «30 ft., fly 60 ft.»."""
    out = v
    for p, r in [(r'\bConcentration, up to\b', 'Concentración, hasta'), (r'\bInstantaneous\b', 'Instantánea'),
                 (r'\bUntil dispelled\b', 'Hasta que se disipe'), (r'\bSelf\b', 'Personal'), (r'\bTouch\b', 'Toque'),
                 (r'\bSight\b', 'Visión'), (r'\bUnlimited\b', 'Ilimitado'), (r'\bSpecial\b', 'Especial'),
                 (r'\bnatural armor\b', 'armadura natural'), (r'\bpassive Perception\b', 'Percepción pasiva'),
                 (r'\bdarkvision\b', 'visión en la oscuridad'), (r'\bblindsight\b', 'vista ciega'),
                 (r'\btruesight\b', 'visión verdadera'), (r'\btremorsense\b', 'sentido de la vibración'), (r'\bor\b', 'o')]:
        out = re.sub(p, r, out, flags=re.I)
    out = re.sub(r'\b(\d+) (bonus action|actions|action|reaction|minutes?|hours?|rounds?|days?|turn)\b',
                 lambda m: f'{m[1]} {TIME_UNITS[m[2]]}', out)
    out = re.sub(r'\b(\d+)\s?(feet|ft\.)', r'\1 pies', out)
    out = re.sub(r'\b(fly|swim|climb|burrow) (\d+)', lambda m: f'{MOVES[m[1]]} {m[2]}', out)
    out = re.sub(rf'\b({DMG_TYPES})\b', lambda m: DAMAGE[m[1].lower()].removeprefix('de '), out, flags=re.I)
    out = re.sub(r'\b(' + '|'.join(SKILLS) + r')\b', lambda m: SKILLS[m[1]], out)
    out = re.sub(r'\b(' + '|'.join(sorted(LANGUAGES, key=len, reverse=True)) + r')\b', lambda m: LANGUAGES[m[1]], out)
    out = re.sub(r'\bXP\b', 'PX', out)
    out = re.sub(r'\b(chain shirt|chain mail|leather armor|studded leather|hide armor|scale mail|plate armor|plate|shield|breastplate|half plate|ring mail|splint)\b',
                 lambda m: {'chain shirt': 'camisote de mallas', 'chain mail': 'cota de mallas', 'leather armor': 'armadura de cuero',
                            'studded leather': 'cuero tachonado', 'hide armor': 'armadura de pieles', 'scale mail': 'cota de escamas',
                            'plate armor': 'armadura de placas', 'plate': 'placas', 'shield': 'escudo', 'breastplate': 'coraza',
                            'half plate': 'semiplacas', 'ring mail': 'cota de anillas', 'splint': 'bandas'}[m[1]], out)
    return re.sub(rf'\b({COND_WORDS})\b', lambda m: CONDITIONS[m[1].lower()], out, flags=re.I)


def rule_line(line):
    """Traducción por reglas de una línea de cabecera; None si la línea es prosa (va al modelo)."""
    t = line.strip()
    if t.upper() in HEADINGS:
        return HEADINGS[t.upper()]
    m = re.match(rf'^{ORD}-level ([a-z]+)( \(ritual\))?$', t, re.I)
    if m and m[2].lower() in SCHOOLS:
        return f'{SCHOOLS[m[2].lower()].capitalize()} de nivel {m[1]}' + (' (ritual)' if m[3] else '')
    m = re.match(r'^([a-z]+) cantrip$', t, re.I)
    if m and m[1].lower() in SCHOOLS:
        return f'Truco de {SCHOOLS[m[1].lower()]}'
    m = re.match(r'^(Tiny|Small|Medium|Large|Huge|Gargantuan) ([a-z]+)(.*?),\s*(.+)$', t)
    if m and len(t) < 80:
        kind = CREATURE_TYPES.get(m[2].lower(), m[2])
        align = m[4].lower()
        for en, es in ALIGNMENTS:
            align = align.replace(en, es)
        return f'{SIZES[m[1]]} {kind}{m[3]}, {align}'
    if t.upper().startswith('STR DEX CON INT WIS CHA'):
        return 'FUE DES CON INT SAB CAR' + t[len('STR DEX CON INT WIS CHA'):]
    for rx, fmt in FIELD:
        fm = rx.match(t)
        if fm:
            return fmt.format(field_value(fm[1]))
    if re.fullmatch(r'[\d\s()+\-−–]+', t):
        return t
    return None


def reflow(text):
    """Junta las líneas cortadas del PDF dentro de un párrafo (si la siguiente sigue la frase)."""
    text = re.sub(r'-\n(?=[a-z])', '', text)
    text = re.sub(r'\bd\s+amage\b', 'damage', text)
    # Un salto de columna o página en mitad de frase deja una línea en blanco: se vuelve a juntar.
    text = re.sub(r'([a-z,;])\n\s*\n(?=[a-z])', r'\1 ', text)
    return re.sub(r'([^\n.:])\n(?=[a-z0-9(,])', r'\1 ', text)


class Translator:
    def __init__(self, model_dir):
        self.sp = spm.SentencePieceProcessor(model_file=f'{model_dir}/sentencepiece.model')
        self.tr = ctranslate2.Translator(f'{model_dir}/model', device='cpu', compute_type='int8', inter_threads=2, intra_threads=4)

    @staticmethod
    def protect(sentence):
        """Sustituye las expresiones de reglas por marcadores ZQn (el modelo los respeta) y guarda su español."""
        keep = []

        def mark(es):
            keep.append(es)
            return f' ZQ{len(keep) - 1}X '

        def attack(m):
            kind = 'de conjuro' if m[2] == 'Spell' else 'con arma'
            return mark(f'Ataque {kind} {ATTACK_ES[m[1]]}: +{m[3]} para impactar, ')
        s = ATTACK_RE.sub(attack, sentence)
        s = re.sub(r'\bHit:\s*', lambda m: mark('Impacto: '), s)
        s = re.sub(r'\breach (\d+)\s?ft\.,?', lambda m: mark(f'alcance {m[1]} pies,'), s)
        s = re.sub(r'\brange (\d+)/(\d+)\s?ft\.,?', lambda m: mark(f'alcance {m[1]}/{m[2]} pies,'), s)
        s = re.sub(r'\bone target\b', lambda m: mark('un objetivo'), s)
        for rx, fn in PROTECT:
            s = rx.sub(lambda m, fn=fn: mark(fn(m)), s)
        return s, keep

    @staticmethod
    def restore(s, keep):
        for _ in range(2):
            s = re.sub(r'ZQ\s?(\d+)\s?X', lambda m: keep[int(m[1])] if int(m[1]) < len(keep) else m[0], s)
        for rx, rep in POST:
            s = rx.sub(rep, s)
        return s.strip()

    @staticmethod
    def sentences(paragraph):
        out = []
        for p in re.split(r'(?<=[.!?])\s+(?=[A-Z"(])', paragraph):
            while len(p) > MAX_SENTENCE_CHARS:
                cut = p.rfind(', ', 0, MAX_SENTENCE_CHARS)
                cut = cut if cut > 0 else MAX_SENTENCE_CHARS
                out.append(p[:cut + 1])
                p = p[cut + 1:].strip()
            if p:
                out.append(p)
        return out

    def translate_title(self, title):
        """Títulos: primero la lista de nombres conocidos; si no, el modelo en minúsculas (traduce mejor los
        nombres propios) y, si sale algo roto, se deja el original."""
        known = known_title(title)
        if known:
            return known
        prot, keep = self.protect(title.lower())
        res = self.tr.translate_batch([self.sp.encode(prot, out_type=str)], beam_size=4)[0]
        out = self.restore(self.sp.decode(res.hypotheses[0]), keep).strip(' .')
        if not out or '##' in out or len(out) > 3 * len(title) + 10:
            return title
        return out[0].upper() + out[1:]

    def translate_texts(self, texts):
        """Cada texto se parte en líneas; las de cabecera van por reglas y la prosa por el modelo."""
        jobs = []
        layout = []
        for ti, text in enumerate(texts):
            lines = []
            for li, line in enumerate(reflow(text).split('\n')):
                # Componentes con material: la cabecera por reglas y lo de dentro del paréntesis por el modelo.
                mat = MATERIAL_RE.match(line.strip())
                if mat:
                    lines.append([f'Componentes: {mat[1].strip()} (', None, ')'])
                    prot, keep = self.protect(mat[2])
                    jobs.append((ti, li, 1, prot, keep))
                    continue
                long_field = LONG_FIELD_RE.match(line.strip())
                if long_field:
                    label = {'casting time': 'Tiempo de lanzamiento', 'range': 'Alcance', 'duration': 'Duración'}[re.sub(r'\s+', ' ', long_field[1].lower()).replace('tim e', 'time')]
                    lines.append([f'{label}: ', None, ''])
                    prot, keep = self.protect(field_value(long_field[2]))
                    jobs.append((ti, li, 1, prot, keep))
                    continue
                ruled = rule_line(line) if line.strip() else ''
                if ruled is not None:
                    lines.append([ruled])
                    continue
                sents = self.sentences(line.strip())
                lines.append([None] * len(sents))
                for si, sent in enumerate(sents):
                    prot, keep = self.protect(sent)
                    jobs.append((ti, li, si, prot, keep))
            layout.append(lines)
        for start in range(0, len(jobs), BATCH):
            chunk = jobs[start:start + BATCH]
            res = self.tr.translate_batch([self.sp.encode(j[3], out_type=str) for j in chunk], beam_size=BEAM, max_batch_size=BATCH)
            for (ti, li, si, _, keep), r in zip(chunk, res):
                layout[ti][li][si] = self.restore(self.sp.decode(r.hypotheses[0]), keep)
        # Las líneas con prefijo fijo («Componentes: … (», «Alcance: ») se pegan sin espacios extra.
        return ['\n'.join(''.join(x for x in line if x) if len(line) == 3 and line[2] in (')', '') else ' '.join(x for x in line if x)
                           for line in lines) for lines in layout]


def main():
    translator = Translator(sys.argv[1])
    print(json.dumps({'ready': True}), flush=True)
    for raw in sys.stdin:
        msg = {}
        try:
            msg = json.loads(raw)
            texts = [str(x) for x in msg.get('texts', [])]
            titles = set(msg.get('titles', []))
            out = translator.translate_texts([t for i, t in enumerate(texts) if i not in titles])
            for i in sorted(titles):
                out.insert(i, translator.translate_title(texts[i]) if i < len(texts) else '')
            print(json.dumps({'id': msg.get('id'), 'out': out}, ensure_ascii=False), flush=True)
        except Exception as err:  # una petición mala no debe tumbar el traductor
            print(json.dumps({'id': msg.get('id'), 'error': str(err)}), flush=True)


if __name__ == '__main__':
    main()
