#!/usr/bin/env python3
"""Prepare manual Xcode signing using a profile already decoded by security cms."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import sys


def prepare(profile_path: Path, decoded_path: Path) -> None:
    with decoded_path.open('rb') as source:
        profile = plistlib.load(source)
    bundle = json.loads(Path('capacitor.config.json').read_text(encoding='utf-8'))['appId']
    team_ids = profile.get('TeamIdentifier', [])
    uuid = profile.get('UUID', '')
    expiry = profile.get('ExpirationDate')
    entitlements = profile.get('Entitlements', {})
    app_id = entitlements.get('application-identifier', '')
    prefixes = profile.get('ApplicationIdentifierPrefix', [])
    if (len(team_ids) != 1 or not re.fullmatch(r'[A-Z0-9]{10}', team_ids[0])
            or not re.fullmatch(r'[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}', uuid)):
        raise ValueError('Provisioning profile identifiers are invalid.')
    if not isinstance(expiry, datetime) or expiry.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc):
        raise ValueError('The provisioning profile has expired.')
    if (entitlements.get('get-task-allow') is not True or not profile.get('ProvisionedDevices')
            or 'iOS' not in profile.get('Platform', [])):
        raise ValueError('A development profile for registered iOS test devices is required.')
    if not any(app_id in {f'{prefix}.{bundle}', f'{prefix}.*'} for prefix in prefixes):
        raise ValueError('The provisioning profile does not match the iOS bundle identifier.')
    team = team_ids[0]
    profiles = Path.home() / 'Library/Developer/Xcode/UserData/Provisioning Profiles'
    profiles.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(profile_path, profiles / f'{uuid}.mobileprovision')
    with (Path(os.environ['RUNNER_TEMP']) / 'ciallo-export-options.plist').open('wb') as target:
        plistlib.dump({
            'method': 'debugging',
            'signingStyle': 'manual',
            'teamID': team,
            'signingCertificate': 'Apple Development',
            'provisioningProfiles': {bundle: uuid},
            'destination': 'export',
        }, target)
    with Path(os.environ['GITHUB_ENV']).open('a', encoding='utf-8') as target:
        target.write(f'CIALLO_TEAM_ID={team}\nCIALLO_PROFILE_UUID={uuid}\n')


if __name__ == '__main__':
    try:
        prepare(Path(sys.argv[1]), Path(sys.argv[2]))
    except ValueError as error:
        sys.exit(str(error))
