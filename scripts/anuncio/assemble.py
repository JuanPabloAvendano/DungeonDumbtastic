# Monta el anuncio: recorta la carga de cada segmento, funde entre ellos y pone la música debajo.
import json, subprocess, sys, glob, os
V = sys.argv[1]
OUT = sys.argv[2]
MUSIC = os.environ.get('MUSIC', '/home/zuno/Work/DungeonAutistic/public/assets/audio/musica-taberna.mp3')
FADE = 0.6
clips = sorted(glob.glob(f'{V}/raw/*.webm'))
def duration(f):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).decode())
# Segundos que se recortan al principio (la página cargando) y al final de cada segmento.
def trim(f):
    name = os.path.basename(f)
    return (0.3, 0.0) if ('intro' in name or 'outro' in name) else (1.1, 0.2)
inputs, parts, durs = [], [], []
for i, f in enumerate(clips):
    a, b = trim(f)
    d = duration(f) - a - b
    inputs += ['-i', f]
    parts.append(f'[{i}:v]trim=start={a}:duration={d},setpts=PTS-STARTPTS,fps=30,scale=1280:720,format=yuv420p[v{i}]')
    durs.append(d)
chain, last, offset = [], 'v0', 0.0
for i in range(1, len(clips)):
    offset += durs[i - 1] - FADE
    out = f'x{i}'
    chain.append(f'[{last}][v{i}]xfade=transition=fade:duration={FADE}:offset={offset:.3f}[{out}]')
    last = out
total = sum(durs) - FADE * (len(clips) - 1)
audio = f'[{len(clips)}:a]volume=0.55,afade=t=in:d=1.2,afade=t=out:st={total - 2.8:.3f}:d=2.8,atrim=duration={total:.3f}[a]'
graph = ';'.join(parts + chain + [audio])
cmd = ['ffmpeg', '-v', 'error', '-y', *inputs, '-stream_loop', '-1', '-i', MUSIC, '-filter_complex', graph,
       '-map', f'[{last}]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
       '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-t', f'{total:.3f}', OUT]
subprocess.check_call(cmd)
print(json.dumps({'segmentos': len(clips), 'duracion_s': round(total, 1)}))
