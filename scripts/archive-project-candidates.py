"""Archive untracked, superseded previews without moving adopted provenance inputs."""
from pathlib import Path
import subprocess, json, hashlib, datetime, shutil

root = Path(__file__).resolve().parent.parent
archive = root / '_local-backups' / ('project-organization-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
tracked = set(subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0'))
audit = json.loads((root/'public/assets/tocho-twelve-blocks-20261019/texture-provenance.json').read_text(encoding='utf-8'))
protected = {v['path'].replace('\\', '/') for v in audit['files']}
targets = list((root/'tmp').rglob('*')) if (root/'tmp').exists() else []
targets += [p for p in (root/'public/assets/tocho-landmark').glob('*.glb') if 'candidate' in p.name or 'experimental' in p.name]
targets += list((root/'scripts').glob('.tmp*')) + list((root/'scripts').glob('_tmp*'))
records = []
for path in targets:
    path = path.resolve()
    if not path.is_file() or not path.is_relative_to(root): continue
    relative = path.relative_to(root).as_posix()
    if relative in tracked or relative in protected: continue
    destination = (archive/'files'/relative).resolve()
    assert destination.is_relative_to(archive.resolve()) and path != root
    digest = hashlib.file_digest(path.open('rb'), 'sha256').hexdigest()
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(path), str(destination))
    assert hashlib.file_digest(destination.open('rb'), 'sha256').hexdigest() == digest
    records.append({'path': relative, 'bytes': destination.stat().st_size, 'sha256': digest})
archive.mkdir(parents=True, exist_ok=True)
(archive/'manifest.json').write_text(json.dumps({'files':records}, ensure_ascii=False, indent=2), encoding='utf-8')
(archive/'README.txt').write_text('Recover any file by copying files/<path> back to the project at <path>. All entries were SHA-256 checked after moving. Adopted provenance inputs and tracked files were excluded.\n', encoding='utf-8')
print(json.dumps({'archive':str(archive), 'files':len(records), 'bytes':sum(r['bytes'] for r in records)}))
