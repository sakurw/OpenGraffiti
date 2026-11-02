import pathlib, sys, unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
from texture_kartaview_sfm_io import anchor_metrics, usable_radial_camera, photo_id_from_sfm_name

class SfMMetricTest(unittest.TestCase):
    def test_msls_ids_preserve_internal_and_leading_dashes(self):
        self.assertEqual(photo_id_from_sfm_name('00000012--a-b_c.jpg'),'-a-b_c')
        self.assertEqual(photo_id_from_sfm_name('00000012-123456.jpg'),'123456')
        with self.assertRaises(ValueError): photo_id_from_sfm_name('../a.jpg')
    def test_axes_are_east_up_south(self):
        result = anchor_metrics([[3,12,4]], [[0,0,0]])
        self.assertEqual(result['rmseMetres'], 13)
        self.assertEqual(result['horizontalRmseMetres'], 5)
        self.assertEqual(result['verticalRmseMetres'], 12)
        self.assertEqual(result['within10Metres'], 0)

    def test_missing_invalid_and_empty_are_not_zero_error(self):
        for a,b in [([],[]), ([[0,0,0]],[]), ([[float('nan'),0,0]],[[0,0,0]]), ([[0,0]],[[0,0]])]:
            with self.assertRaises(ValueError):
                anchor_metrics(a,b)

    def test_degenerate_camera_is_not_used_for_photo_remapping(self):
        camera={'model':'SIMPLE_RADIAL','width':1920,'height':1080,'params':[1562,960,540,-.0064]}
        self.assertTrue(usable_radial_camera(camera))
        for params in [[3500,960,540,7.24],[1562,960,540,float('nan')],[300,960,540,-.9],[None,960,540,0]]:
            self.assertFalse(usable_radial_camera({**camera,'params':params}))

if __name__ == '__main__':
    unittest.main()
