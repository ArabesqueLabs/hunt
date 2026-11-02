#!/usr/bin/env python3
"""The Safari build's own steps, around Xcode's converter (see the Makefile).

    adapt.py extension <dir>             before converting: the extension in <dir>
    adapt.py project <dir> <macos> <build>  after: the Xcode project in <dir>

Before: Safari doesn't take a background service worker that's an ES module
("type": "module"), so the background script and the lib/ modules it uses
are joined into one plain script, which replaces background.js there. The
popup and the settings page stay modules: pages may be.

After: the project the converter makes targets the newest macOS for the app
(it leaves the project's own default in place), and versions it 1.0. Both
targets are set to <macos>, the version to the manifest's, the build number
to <build> (each upload to App Store Connect needs a higher one), and the
app gets hunt's icon (app-icon.png, drawn from app-icon.svg).
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))

# The background script's modules, each after those it uses.
MODULES = ['lib/settings.js', 'lib/i18n.js', 'lib/hunt.js', 'lib/linkedin.js', 'background.js']

IMPORT = re.compile(r"^import \{[^}]*\} from '[^']+';\n", re.M)
EXPORT = re.compile(r'^export (?=(async )?(function|const|let|class) )', re.M)


def die(message):
    sys.exit('adapt.py: ' + message)


def extension(root):
    parts = ['// Made by safari/adapt.py from ' + ', '.join(MODULES) + ', joined into one\n'
             '// plain script: Safari\'s background service worker can\'t be a module.\n']
    for name in MODULES:
        with open(os.path.join(root, name)) as f:
            text = EXPORT.sub('', IMPORT.sub('', f.read()))
        left = re.search(r'^\s*(import|export)\b.*', text, re.M)
        if left:
            die(f'{name}: can\'t join "{left.group(0).strip()}": import on one line, as import {{ … }} from \'…\';')
        parts.append(f'\n// ---- {name}\n\n{text}')
    script = ''.join(parts)

    # Joined, two modules mustn't declare the same name. Checked as a
    # module, a name declared twice is an error (in a plain script, a
    # function declared twice is quietly the last one).
    if shutil.which('node'):
        with tempfile.TemporaryDirectory() as tmp:
            check = os.path.join(tmp, 'background.mjs')
            with open(check, 'w') as f:
                f.write(script)
            if subprocess.run(['node', '--check', check]).returncode:
                die('the joined background script doesn\'t parse (a name declared in two modules?)')

    with open(os.path.join(root, 'background.js'), 'w') as f:
        f.write(script)

    path = os.path.join(root, 'manifest.json')
    with open(path) as f:
        manifest = json.load(f)
    manifest['background'] = {'service_worker': 'background.js'}
    # Safari opens the settings in a tab anyway, and warns about the key.
    manifest.get('options_ui', {}).pop('open_in_tab', None)
    with open(path, 'w') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write('\n')


def project(root, macos, build):
    with open(os.path.join(HERE, '..', 'src', 'manifest-chrome.json')) as f:
        version = json.load(f)['version']

    [xcodeproj] = [d for d in os.listdir(root) if d.endswith('.xcodeproj')] or [None]
    if not xcodeproj:
        die(f'no Xcode project in {root}')
    path = os.path.join(root, xcodeproj, 'project.pbxproj')
    with open(path) as f:
        text = f.read()
    for key, value in [('MACOSX_DEPLOYMENT_TARGET', macos), ('MARKETING_VERSION', version),
                       ('CURRENT_PROJECT_VERSION', build)]:
        text, n = re.subn(rf'(\b{key} = )[^;]*;', rf'\g<1>{value};', text)
        if not n:
            die(f'no {key} in {path}')
    with open(path, 'w') as f:
        f.write(text)

    # The app's icon, at each size its asset catalogue asks for, and the
    # one its window shows.
    source = os.path.join(HERE, 'app-icon.png')
    found = False
    for dirpath, _, files in os.walk(root):
        if dirpath.endswith('AppIcon.appiconset') and 'Contents.json' in files:
            found = True
            with open(os.path.join(dirpath, 'Contents.json')) as f:
                images = json.load(f)['images']
            for image in images:
                if 'filename' not in image:
                    continue
                side = int(float(image['size'].split('x')[0]) * int(image['scale'].rstrip('x')))
                resize(source, side, os.path.join(dirpath, image['filename']))
        if os.path.basename(dirpath) == 'Resources' and 'Icon.png' in files and 'manifest.json' not in files:
            resize(source, 256, os.path.join(dirpath, 'Icon.png'))
    if not found:
        die(f'no AppIcon.appiconset in {root}')


def resize(source, side, target):
    subprocess.run(['sips', '-z', str(side), str(side), source, '--out', target],
                   check=True, stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    if sys.argv[1:2] == ['extension'] and len(sys.argv) == 3:
        extension(sys.argv[2])
    elif sys.argv[1:2] == ['project'] and len(sys.argv) == 5:
        project(*sys.argv[2:])
    else:
        die('usage: adapt.py extension <dir> | adapt.py project <dir> <macos> <build>')
