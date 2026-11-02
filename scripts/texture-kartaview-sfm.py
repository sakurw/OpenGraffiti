"""Reconstruct cameras from actual KartaView sequences, not their API headings.

Outputs are relative SfM hypotheses. They are NOT georegistered SNAP inputs.
Original images are hash-verified and preserved byte-for-byte in work copies.
"""
import argparse, hashlib, json, pathlib, shutil, sys, time, traceback, re
import pycolmap
from PIL import Image
from texture_kartaview_sfm_io import save

ROOT = pathlib.Path(__file__).resolve().parents[1]

def digest(data):
    return hashlib.sha256(data).hexdigest()

def run(sequence, provider='kartaview', min_sequence_index=None, max_sequence_index=None, matcher='sequential'):
    assert pycolmap.__version__ == '4.2.0', 'Use pinned pycolmap 4.2.0'
    assert provider in ['kartaview','msls']
    assert sequence.isdigit() if provider=='kartaview' else re.fullmatch(r'[A-Za-z0-9_-]+',sequence)
    source_root = ROOT / f'data/texture-city/photos/{provider}'
    photos = []
    for path in source_root.glob('*.json'):
        if provider=='kartaview' and not path.stem.isdigit():
            continue
        photo = json.loads(path.read_text(encoding='utf8'))
        if str(photo['sequenceId']) == sequence:
            assert photo['provider'] == provider
            assert photo['projection']=='PLANE' if provider=='kartaview' else photo['pano']=='False'
            assert photo['status'] == 'downloaded'
            assert digest(path.with_suffix('.jpg').read_bytes()) == photo['sha256']
            photos.append(photo)
    photos.sort(key=lambda p: int(p['sequenceIndex']))
    if min_sequence_index is not None:
        photos = [p for p in photos if int(p['sequenceIndex']) >= min_sequence_index]
    if max_sequence_index is not None:
        photos = [p for p in photos if int(p['sequenceIndex']) <= max_sequence_index]
    assert len(photos) >= 10, 'At least 10 saved images required for this sequence'
    download_sizes = [tuple(int(v) for v in p['downloadSize']) for p in photos]
    # KartaView can expose the same physical camera through a mix of processed
    # images and long-thumbnail fallbacks.  Those variants keep essentially the
    # same aspect ratio but have different pixel dimensions.  SfM uses one
    # shared camera for the sequence, so normalise only the *working copies* to
    # one conservative resolution while preserving every downloaded source byte
    # and source SHA-256 unchanged.
    aspect_ratios = [w / h for w, h in download_sizes]
    assert max(aspect_ratios) - min(aspect_ratios) <= 0.002, 'Shared-camera inputs have inconsistent aspect ratios'
    working_size = min(download_sizes, key=lambda size: size[0] * size[1])
    config = {'pycolmap': pycolmap.__version__, 'cameraModel': 'SIMPLE_RADIAL',
              'initialFocalFactor': .83, 'maxImageSize': 1600, 'maxFeatures': 8192,
              'threads': 8, 'sequentialOverlap': 10, 'quadraticOverlap': True,
              'matcher': matcher, 'minSequenceIndex': min_sequence_index,
              'maxSequenceIndex': max_sequence_index,
              'workingSize': list(working_size), 'workingResize': 'LANCZOS',
              'seed': 0, 'device': 'cpu', 'useApiHeading': False, 'useGpsPrior': False}
    inputs = [{'id': p['id'], 'sha256': p['sha256'], 'sequenceIndex': p['sequenceIndex'],
               'size': p['downloadSize'], 'lat': p['lat'], 'lng': p['lng'],
               'gpsAccuracy': p.get('gpsAccuracy'), 'shotDate': p['shotDate']} for p in photos]
    key = digest(json.dumps({'config': config, 'inputs': inputs}, sort_keys=True).encode())[:20]
    work = ROOT / f'data/texture-city/{provider}/sfm/{sequence}-{key}'
    images = work / 'images'
    images.mkdir(parents=True, exist_ok=True)
    manifest = {'sequenceId': sequence, 'config': config, 'inputs': inputs, 'key': key,
                'note': 'No API heading/GPS is used in reconstruction. Relative scale and reference frame only; not ready for SNAP or texture projection.'}
    save(work / 'inputs.json', manifest)
    if (work / 'result.json').exists():
        print((work / 'result.json').read_text(encoding='utf8'), flush=True)
        return
    names = {}
    for photo in photos:
        name = f"{int(photo['sequenceIndex']):08d}-{photo['id']}.jpg"
        destination = images / name
        source = source_root / f"{photo['id']}.jpg"
        assert digest(source.read_bytes()) == photo['sha256'], 'Source image hash mismatch'
        source_size = tuple(int(v) for v in photo['downloadSize'])
        if not destination.exists():
            if source_size == working_size:
                shutil.copyfile(source, destination)
            else:
                with Image.open(source) as image:
                    assert image.size == source_size, 'Downloaded image dimensions disagree with metadata'
                    image.resize(working_size, Image.Resampling.LANCZOS).save(destination, 'JPEG', quality=95, subsampling=0)
        with Image.open(destination) as image:
            assert image.size == working_size, 'SfM working copy dimensions are inconsistent'
        names[name] = photo
    database = work / 'database.db'
    reader = pycolmap.ImageReaderOptions(camera_model=config['cameraModel'], default_focal_length_factor=config['initialFocalFactor'])
    extraction = pycolmap.FeatureExtractionOptions(max_image_size=config['maxImageSize'], num_threads=config['threads'], use_gpu=False)
    extraction.sift.max_num_features = config['maxFeatures']
    print(json.dumps({'stage': 'features', 'sequence': sequence, 'images': len(photos), 'work': str(work)}), flush=True)
    try:
        pycolmap.extract_features(database, images, camera_mode=pycolmap.CameraMode.SINGLE,
                                  reader_options=reader, extraction_options=extraction, device=pycolmap.Device.cpu)
        print(json.dumps({'stage': 'matching', 'sequence': sequence}), flush=True)
        matching = pycolmap.FeatureMatchingOptions(num_threads=config['threads'], use_gpu=False)
        if matcher == 'exhaustive':
            pairing = pycolmap.ExhaustivePairingOptions(block_size=50)
            pycolmap.match_exhaustive(database, matching_options=matching, pairing_options=pairing, device=pycolmap.Device.cpu)
        else:
            pairing = pycolmap.SequentialPairingOptions(overlap=config['sequentialOverlap'], quadratic_overlap=True, loop_detection=False)
            pycolmap.match_sequential(database, matching_options=matching, pairing_options=pairing, device=pycolmap.Device.cpu)
        attempt = work / ('sparse-' + time.strftime('%Y%m%d-%H%M%S'))
        attempt.mkdir(exist_ok=False)
        options = pycolmap.IncrementalPipelineOptions(num_threads=config['threads'], random_seed=0)
        options.mapper.num_threads = config['threads']
        options.mapper.random_seed = 0
        (attempt / 'snapshots').mkdir()
        options.snapshot_path = str(attempt / 'snapshots')
        options.snapshot_frames_freq = 25
        print(json.dumps({'stage': 'mapping', 'sequence': sequence, 'output': str(attempt)}), flush=True)
        models = pycolmap.incremental_mapping(database, images, attempt, options=options)
        summaries = []
        registered = set()
        for model_id, model in models.items():
            records = []
            for image_id in model.reg_image_ids():
                image = model.images[image_id]
                photo = names[image.name]
                registered.add(photo['id'])
                records.append({'id': photo['id'], 'name': image.name, 'sourceSha256': photo['sha256'],
                                'cameraId': image.camera_id, 'relativeCenter': image.projection_center().tolist(),
                                'camFromWorld': image.cam_from_world().matrix().tolist()})
            cameras = [{'id': c.camera_id, 'model': c.model_name, 'width': c.width, 'height': c.height,
                        'params': c.params.tolist()} for c in model.cameras.values()]
            summary = {'modelId': model_id, 'registeredImages': len(records), 'points3D': model.num_points3D(),
                       'meanReprojectionError': model.compute_mean_reprojection_error(), 'cameras': cameras, 'images': records}
            save(attempt / f'model-{model_id}-cameras.json', summary)
            summaries.append({k: v for k, v in summary.items() if k != 'images'})
        result = {'sequenceId': sequence, 'key': key, 'inputImages': len(photos), 'registeredImages': len(registered),
                  'unregisteredIds': [p['id'] for p in photos if p['id'] not in registered], 'models': summaries,
                  'output': str(attempt.relative_to(ROOT)), 'applied': False, 'georegistered': False,
                  'status': 'relative-reconstruction-unverified' if models else 'no-reconstruction',
                  'note': 'Reprojection error measures input feature consistency, not surveyed accuracy, correct building identity, complete facade coverage, or independent capture.'}
        save(work / 'result.json', result)
        print(json.dumps(result, ensure_ascii=False), flush=True)
    except Exception:
        (work / 'failure.txt').write_text(traceback.format_exc(), encoding='utf8')
        raise

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('sequence')
    parser.add_argument('--provider',choices=['kartaview','msls'],default='kartaview')
    parser.add_argument('--min-sequence-index', type=int)
    parser.add_argument('--max-sequence-index', type=int)
    parser.add_argument('--matcher', choices=['sequential','exhaustive'], default='sequential')
    args = parser.parse_args()
    run(args.sequence,args.provider,args.min_sequence_index,args.max_sequence_index,args.matcher)
