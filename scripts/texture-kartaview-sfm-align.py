"""Align relative SfM to approximate GPS/road-height anchors, with held-out GPS.

This does NOT certify building correspondence and does not modify SNAP inputs.
"""
import argparse, hashlib, json, pathlib, re
import numpy as np
import pycolmap
from texture_kartaview_sfm_io import save, anchor_metrics, photo_id_from_sfm_name

ROOT = pathlib.Path(__file__).resolve().parents[1]


def sequence_drift_candidate(model, group, expected, degree):
    """Fit smooth post-similarity camera-centre drift on training GPS only.

    Long street sequences can accumulate relative SfM scale drift that a single
    7-DoF similarity cannot remove.  We model only the remaining camera-centre
    residual as a low-order function of sequence index.  Camera rotation and
    intrinsics remain untouched; held-out GPS decides whether the correction is
    allowed to replace the rigid similarity result.
    """
    indices = np.asarray([float(expected[p['id']]['sequenceIndex']) for p in group], float)
    center = float(indices.mean())
    spread = float(indices.std())
    if not np.isfinite(spread) or spread < 1.0:
        spread = 1.0
    x = (indices - center) / spread
    design = np.column_stack([x ** power for power in range(degree + 1)])
    residual = np.asarray([
        model.images[p['imageId']].projection_center() - np.asarray(p['target'], float)
        for p in group
    ])

    weights = np.ones(len(group), float)
    coefficients = None
    for _ in range(5):
        root_weight = np.sqrt(weights)[:, None]
        coefficients = np.linalg.lstsq(design * root_weight, residual * root_weight, rcond=None)[0]
        remaining = np.linalg.norm(residual - design @ coefficients, axis=1)
        median = float(np.median(remaining))
        mad = float(np.median(np.abs(remaining - median)))
        sigma = max(1.4826 * mad, .25)
        cutoff = max(2.5 * sigma, .75)
        weights = np.minimum(1.0, cutoff / np.maximum(remaining, 1e-9))

    return {
        'degree': degree,
        'centerIndex': center,
        'scaleIndex': spread,
        'coefficients': coefficients,
    }


def sequence_drift_at(candidate, sequence_index):
    value = (float(sequence_index) - candidate['centerIndex']) / candidate['scaleIndex']
    basis = np.asarray([value ** power for power in range(candidate['degree'] + 1)], float)
    return basis @ candidate['coefficients']


def corrected_metrics(model, group, expected, candidate):
    predicted = []
    expected_positions = []
    for p in group:
        position = model.images[p['imageId']].projection_center()
        correction = sequence_drift_at(candidate, expected[p['id']]['sequenceIndex'])
        predicted.append((position - correction).tolist())
        expected_positions.append(p['target'])
    return anchor_metrics(predicted, expected_positions)


def choose_sequence_drift(model, train, held_out, expected):
    baseline_train = anchor_metrics(
        [model.images[p['imageId']].projection_center().tolist() for p in train],
        [p['target'] for p in train],
    )
    baseline_hold = anchor_metrics(
        [model.images[p['imageId']].projection_center().tolist() for p in held_out],
        [p['target'] for p in held_out],
    )
    candidates = []
    if len(train) >= 10 and len(held_out) >= 3:
        for degree in (1, 2):
            candidate = sequence_drift_candidate(model, train, expected, degree)
            training = corrected_metrics(model, train, expected, candidate)
            held = corrected_metrics(model, held_out, expected, candidate)
            all_corrections = np.asarray([
                sequence_drift_at(candidate, expected[p['id']]['sequenceIndex'])
                for p in train + held_out
            ])
            max_correction = float(np.max(np.linalg.norm(all_corrections, axis=1)))
            candidates.append({
                **candidate,
                'training': training,
                'heldOut': held,
                'maxCorrectionMetres': max_correction,
            })

    chosen = None
    for candidate in candidates:
        held = candidate['heldOut']
        improvement = baseline_hold['rmseMetres'] - held['rmseMetres']
        relative = held['rmseMetres'] / max(baseline_hold['rmseMetres'], 1e-9)
        stable = (
            candidate['maxCorrectionMetres'] <= 25.0 and
            held['medianMetres'] <= baseline_hold['medianMetres'] + .5 and
            held['maxMetres'] <= baseline_hold['maxMetres'] + 1.0
        )
        material = improvement >= .75 and relative <= .8
        if not (stable and material):
            continue
        if chosen is None or held['rmseMetres'] < chosen['heldOut']['rmseMetres'] - .05:
            chosen = candidate

    return baseline_train, baseline_hold, chosen, candidates

def run(work_name, provider='kartaview'):
    assert provider in ['kartaview','msls']
    assert re.fullmatch(r'[A-Za-z0-9_-]+-[a-f0-9]{20}', work_name)
    assert pycolmap.__version__ == '4.2.0'
    work = ROOT / f'data/texture-city/{provider}/sfm' / work_name
    result = json.loads((work / 'result.json').read_text(encoding='utf8'))
    inputs = json.loads((work / 'inputs.json').read_text(encoding='utf8'))
    assert result['key'] == inputs['key'] and result['sequenceId'] == inputs['sequenceId']
    source_path = (ROOT / result['output']).resolve()
    assert source_path.is_relative_to(work.resolve()) and source_path.is_dir()
    location_bytes = (ROOT / f'data/texture-city/{provider}/locations.json').read_bytes()
    location_hash = hashlib.sha256(location_bytes).hexdigest()
    locations = json.loads(location_bytes)['locations']
    expected = {p['id']: p for p in inputs['inputs']}
    known = {p['id']: p for p in locations if p['id'] in expected and p['position'] is not None}
    for photo_id, p in known.items():
        assert p['sourceSha256'] == expected[photo_id]['sha256']
    area_ids = {p['areaId'] for p in known.values()}
    assert len(area_ids) == 1, 'A shared local coordinate frame is required'
    output = source_path / f'geo-{location_hash[:16]}'
    output.mkdir(exist_ok=True)
    summaries = []
    for description in result['models']:
        model_id = description['modelId']
        model = pycolmap.Reconstruction(source_path / str(model_id))
        rows = []
        for image_id in model.reg_image_ids():
            image = model.images[image_id]
            photo_id = photo_id_from_sfm_name(image.name)
            assert photo_id in expected
            if photo_id in known:
                rows.append({'id': photo_id, 'imageId': image_id, 'name': image.name, 'target': known[photo_id]['position']})
        rows.sort(key=lambda p: int(expected[p['id']]['sequenceIndex']))
        train = [p for i,p in enumerate(rows) if i % 5 != 0]
        held_out = [p for i,p in enumerate(rows) if i % 5 == 0]
        base = {'modelId': model_id, 'registeredImages': model.num_reg_images(), 'anchors': len(rows),
                'trainingAnchors': len(train), 'heldOutAnchors': len(held_out)}
        if len(train) < 6 or len(held_out) < 2:
            summaries.append({**base, 'status': 'insufficient-anchors'})
            continue
        opts = pycolmap.RANSACOptions(max_error=10, random_seed=0)
        transform = pycolmap.align_reconstruction_to_locations(model, [p['name'] for p in train],
                                                               np.asarray([p['target'] for p in train]), 6, opts)
        if transform is None:
            summaries.append({**base, 'status': 'alignment-failed'})
            continue
        assert np.isfinite(transform.matrix()).all() and transform.scale > 0
        model.transform(transform)
        baseline_training, baseline_held_out, drift, drift_candidates = choose_sequence_drift(
            model, train, held_out, expected,
        )

        def output_position(image, photo_id):
            position = image.projection_center()
            if drift is not None:
                position = position - sequence_drift_at(drift, expected[photo_id]['sequenceIndex'])
            return np.asarray(position, float)

        records = []
        for image_id in model.reg_image_ids():
            image = model.images[image_id]
            photo_id = photo_id_from_sfm_name(image.name)
            position = output_position(image, photo_id)
            pose = np.asarray(image.cam_from_world().matrix(), float)
            rotation = pose[:, :3]
            cam_from_world = np.c_[rotation, -rotation @ position]
            records.append({'id': photo_id, 'name': image.name, 'cameraId': image.camera_id,
                            'sourceSha256': expected[photo_id]['sha256'],
                            'position': position.tolist(), 'camFromWorld': cam_from_world.tolist()})
        cameras = [{'id': c.camera_id, 'model': c.model_name, 'width': c.width, 'height': c.height,
                    'params': c.params.tolist()} for c in model.cameras.values()]
        training = drift['training'] if drift is not None else baseline_training
        held = drift['heldOut'] if drift is not None else baseline_held_out
        public_drift = None if drift is None else {
            'degree': drift['degree'],
            'centerIndex': drift['centerIndex'],
            'scaleIndex': drift['scaleIndex'],
            'coefficients': drift['coefficients'].tolist(),
            'maxCorrectionMetres': drift['maxCorrectionMetres'],
        }
        public_candidates = [{
            'degree': candidate['degree'],
            'training': candidate['training'],
            'heldOut': candidate['heldOut'],
            'maxCorrectionMetres': candidate['maxCorrectionMetres'],
        } for candidate in drift_candidates]
        detail = {**base, 'status': 'gps-aligned-unverified', 'training': training, 'heldOut': held,
                  'baselineTraining': baseline_training, 'baselineHeldOut': baseline_held_out,
                  'transform': transform.matrix().tolist(), 'scale': float(transform.scale),
                  'alignmentMode': 'similarity+sequence-drift' if drift is not None else 'similarity',
                  'sequenceDrift': public_drift, 'sequenceDriftCandidates': public_candidates,
                  'images': records, 'cameras': cameras, 'trainingIds': [p['id'] for p in train], 'heldOutIds': [p['id'] for p in held_out]}
        model_path = output / str(model_id)
        model_path.mkdir(exist_ok=True)
        model.write(model_path)
        save(output / f'model-{model_id}-cameras.json', detail)
        summaries.append({k:v for k,v in detail.items() if k not in ['images','trainingIds','heldOutIds']})
    report = {'sequenceId': result['sequenceId'], 'areaId': next(iter(area_ids)), 'locationSha256': location_hash,
              'sourceResultSha256': hashlib.sha256((work / 'result.json').read_bytes()).hexdigest(),
              'models': summaries, 'output': str(output.relative_to(ROOT)), 'applied': False,
              'note': 'Scale and pose are fitted to approximate GPS/road heights. A low-order sequence-index camera-centre drift correction is used only when training-only fitting materially improves held-out GPS; rotation/intrinsics remain SfM-derived. Held-out GPS is not surveyed control or held-out facade correspondence; wall alignment and capture independence remain unverified.'}
    save(output / 'alignment.json', report)
    print(json.dumps(report, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('work_name')
    parser.add_argument('--provider',choices=['kartaview','msls'],default='kartaview')
    args=parser.parse_args()
    run(args.work_name,args.provider)
