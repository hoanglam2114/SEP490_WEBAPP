import express from 'express';
import { DataPrepVersionController } from './version.controller';

const router = express.Router();
const controller = new DataPrepVersionController();

router.post('/', (req, res) => controller.createVersion(req, res));
router.get('/:id', (req, res) => controller.getVersion(req, res));
router.patch('/:id/visibility', (req, res) => controller.updateVisibility(req, res));
router.patch('/:id/share', (req, res) => controller.updateSharing(req, res));
router.delete('/items/:sampleId', (req, res) => controller.deleteSample(req, res));

export default router;
