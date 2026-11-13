"""Nombres en español de conjuros, monstruos y objetos frecuentes (los que el modelo suele traducir mal).

Solo los títulos: lo demás lo traduce el modelo. Lo que no está aquí se traduce en minúsculas y, si sale
roto, se deja el original.
"""
import re

TITLES = {
    # Conjuros
    'Acid Splash': 'Salpicadura de ácido', 'Aid': 'Ayuda', 'Alarm': 'Alarma', 'Animate Dead': 'Animar a los muertos',
    'Animate Objects': 'Animar objetos', 'Arcane Lock': 'Cerradura arcana', 'Bane': 'Perdición', 'Banishment': 'Destierro',
    'Barkskin': 'Piel robliza', 'Bless': 'Bendición', 'Blindness/Deafness': 'Ceguera/sordera', 'Blink': 'Intermitencia',
    'Blur': 'Desenfoque', 'Burning Hands': 'Manos ardientes', 'Call Lightning': 'Invocar relámpagos', 'Charm Person': 'Hechizar persona',
    'Chill Touch': 'Toque gélido', 'Cloudkill': 'Nube aniquiladora', 'Command': 'Orden imperiosa', 'Comprehend Languages': 'Comprensión idiomática',
    'Cone of Cold': 'Cono de frío', 'Confusion': 'Confusión', 'Counterspell': 'Contraconjuro', 'Create or Destroy Water': 'Crear o destruir agua',
    'Cure Wounds': 'Curar heridas', 'Dancing Lights': 'Luces danzantes', 'Darkness': 'Oscuridad', 'Darkvision': 'Visión en la oscuridad',
    'Daylight': 'Luz del día', 'Death Ward': 'Custodia contra la muerte', 'Detect Magic': 'Detectar magia', 'Detect Thoughts': 'Detectar pensamientos',
    'Dimension Door': 'Puerta dimensional', 'Disguise Self': 'Disfrazarse', 'Disintegrate': 'Desintegrar', 'Dispel Magic': 'Disipar magia',
    'Divine Favor': 'Favor divino', 'Eldritch Blast': 'Descarga sobrenatural', 'Entangle': 'Enmarañar', 'Expeditious Retreat': 'Retirada expeditiva',
    'Faerie Fire': 'Fuego feérico', 'False Life': 'Vida falsa', 'Fear': 'Miedo', 'Feather Fall': 'Caída de pluma', 'Find Familiar': 'Encontrar familiar',
    'Fire Bolt': 'Rayo de fuego', 'Fireball': 'Bola de fuego', 'Flame Strike': 'Golpe flamígero', 'Fly': 'Volar', 'Fog Cloud': 'Nube de niebla',
    'Gaseous Form': 'Forma gaseosa', 'Goodberry': 'Bayas buenas', 'Grease': 'Grasa', 'Greater Invisibility': 'Invisibilidad mayor',
    'Guidance': 'Orientación', 'Guiding Bolt': 'Saeta guía', 'Haste': 'Acelerar', 'Heal': 'Sanar', 'Healing Word': 'Palabra curativa',
    'Heat Metal': 'Calentar metal', 'Heroism': 'Heroísmo', 'Hex': 'Maleficio', 'Hold Monster': 'Inmovilizar monstruo', 'Hold Person': 'Inmovilizar persona',
    "Hunter's Mark": 'Marca del cazador', 'Ice Storm': 'Tormenta de hielo', 'Identify': 'Identificar', 'Inflict Wounds': 'Infligir heridas',
    'Invisibility': 'Invisibilidad', 'Jump': 'Saltar', 'Knock': 'Apertura', 'Lesser Restoration': 'Restablecimiento menor', 'Levitate': 'Levitar',
    'Light': 'Luz', 'Lightning Bolt': 'Relámpago', 'Mage Armor': 'Armadura de mago', 'Mage Hand': 'Mano de mago', 'Magic Missile': 'Proyectil mágico',
    'Magic Weapon': 'Arma mágica', 'Mass Cure Wounds': 'Curar heridas en masa', 'Mending': 'Remendar', 'Message': 'Mensaje', 'Meteor Swarm': 'Lluvia de meteoritos',
    'Minor Illusion': 'Ilusión menor', 'Mirror Image': 'Imagen especular', 'Misty Step': 'Paso brumoso', 'Moonbeam': 'Rayo de luna',
    'Pass without Trace': 'Pasar sin rastro', 'Polymorph': 'Polimorfar', 'Power Word Kill': 'Palabra de poder: matar', 'Prayer of Healing': 'Plegaria de curación',
    'Prestidigitation': 'Prestidigitación', 'Produce Flame': 'Crear llama', 'Protection from Evil and Good': 'Protección contra el bien y el mal',
    'Raise Dead': 'Revivir a los muertos', 'Ray of Frost': 'Rayo de escarcha', 'Resistance': 'Resistencia', 'Revivify': 'Revivir',
    'Sacred Flame': 'Llama sagrada', 'Sanctuary': 'Santuario', 'Scorching Ray': 'Rayo abrasador', 'Shatter': 'Romper', 'Shield': 'Escudo',
    'Shield of Faith': 'Escudo de fe', 'Shocking Grasp': 'Agarre electrizante', 'Silence': 'Silencio', 'Silent Image': 'Imagen silenciosa',
    'Sleep': 'Dormir', 'Spare the Dying': 'Estabilizar', 'Speak with Animals': 'Hablar con los animales', 'Spider Climb': 'Trepar cual arácnido',
    'Spirit Guardians': 'Espíritus guardianes', 'Spiritual Weapon': 'Arma espiritual', 'Stinking Cloud': 'Nube apestosa', 'Suggestion': 'Sugestión',
    'Teleport': 'Teletransporte', 'Thaumaturgy': 'Taumaturgia', 'Thunderwave': 'Onda atronadora', 'Thunderous Smite': 'Castigo atronador',
    'True Strike': 'Impacto certero', 'Vicious Mockery': 'Burla cruel', 'Wall of Fire': 'Muro de fuego', 'Web': 'Telaraña', 'Wish': 'Deseo',
    'Witch Bolt': 'Descarga de bruja', 'Word of Recall': 'Palabra de regreso',
    # Monstruos
    'Beholder': 'Contemplador', 'Mind Flayer': 'Azotamentes', 'Owlbear': 'Oso lechuza', 'Gelatinous Cube': 'Cubo gelatinoso', 'Bugbear': 'Osgo',
    'Orc': 'Orco', 'Ogre': 'Ogro', 'Troll': 'Trol', 'Lich': 'Liche', 'Vampire': 'Vampiro', 'Zombie': 'Zombi', 'Skeleton': 'Esqueleto',
    'Ghoul': 'Necrófago', 'Ghost': 'Fantasma', 'Wraith': 'Espectro', 'Wight': 'Tumulario', 'Mimic': 'Mimeto', 'Basilisk': 'Basilisco',
    'Griffon': 'Grifo', 'Hydra': 'Hidra', 'Manticore': 'Mantícora', 'Wyvern': 'Guiverno', 'Displacer Beast': 'Bestia desplazadora',
    'Rust Monster': 'Monstruo corrosivo', 'Harpy': 'Arpía', 'Minotaur': 'Minotauro', 'Werewolf': 'Hombre lobo', 'Wolf': 'Lobo',
    'Dire Wolf': 'Lobo terrible', 'Giant Spider': 'Araña gigante', 'Goblin Boss': 'Jefe goblin', 'Kobold': 'Kóbold', 'Bandit': 'Bandido',
    'Bandit Captain': 'Capitán bandido', 'Guard': 'Guardia', 'Cultist': 'Sectario', 'Cult Fanatic': 'Fanático sectario', 'Priest': 'Sacerdote',
    'Mage': 'Mago', 'Archmage': 'Archimago', 'Knight': 'Caballero', 'Veteran': 'Veterano', 'Thug': 'Matón', 'Spy': 'Espía', 'Noble': 'Noble',
    'Commoner': 'Plebeyo', 'Death Knight': 'Caballero de la muerte', 'Gargoyle': 'Gárgola', 'Doppelganger': 'Doppelganger',
    # Objetos
    'Bag of Holding': 'Bolsa de contención', 'Potion of Healing': 'Poción de curación', 'Cloak of Protection': 'Capa de protección',
    'Ring of Protection': 'Anillo de protección', 'Boots of Speed': 'Botas de velocidad', 'Boots of Elvenkind': 'Botas élficas',
    'Cloak of Elvenkind': 'Capa élfica', 'Gauntlets of Ogre Power': 'Guanteletes de fuerza de ogro', 'Wand of Fireballs': 'Varita de bolas de fuego',
    'Wand of Magic Missiles': 'Varita de proyectiles mágicos', 'Immovable Rod': 'Vara inamovible', 'Deck of Many Things': 'Baraja de muchas cosas',
    'Flame Tongue': 'Lengua de fuego', 'Vorpal Sword': 'Espada vorpal', 'Holy Avenger': 'Vengadora sagrada', 'Sending Stones': 'Piedras de mensaje',
}
COLORS = {'Red': 'rojo', 'Blue': 'azul', 'Green': 'verde', 'Black': 'negro', 'White': 'blanco', 'Gold': 'dorado', 'Silver': 'plateado',
          'Bronze': 'de bronce', 'Copper': 'de cobre', 'Brass': 'de latón', 'Shadow': 'de las sombras'}
AGES = {'Ancient': 'anciano', 'Adult': 'adulto', 'Young': 'joven'}
DRAGON_RE = re.compile(r'^(?:(Ancient|Adult|Young) )?(' + '|'.join(COLORS) + r') Dragon( Wyrmling)?$')


def known_title(title):
    """Nombre en español si es uno de los conocidos (o un dragón por color y edad); si no, None."""
    t = title.strip()
    if t in TITLES:
        return TITLES[t]
    m = DRAGON_RE.match(t)
    if m:
        age = AGES.get(m[1]) if m[1] else ('recién nacido' if m[3] else None)
        return ' '.join(x for x in ['Dragón', COLORS[m[2]], age] if x)
    return None
