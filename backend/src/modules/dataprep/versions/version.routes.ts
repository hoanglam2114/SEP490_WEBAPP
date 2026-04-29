import express from 'express';
import { DataPrepVersionController } from './version.controller';

const router = express.Router();
const controller = new DataPrepVersionController();

router.post('/', (req, res) => controller.createVersion(req, res));
router.get('/:id', (req, res) => controller.getVersion(req, res));
router.patch('/:id/visibility', (req, res) => controller.updateVisibility(req, res));
router.patch('/:id/share', (req, res) => controller.updateSharing(req, res));
router.get('/:id/assignments', (req, res) => controller.getAssignments(req, res));
router.post('/:id/assignments/range', (req, res) => controller.assignRange(req, res));
router.delete('/:id/assignments/range', (req, res) => controller.clearAssignmentRange(req, res));
router.delete('/:id/assignments/users/:userId', (req, res) => controller.clearUserAssignments(req, res));
router.delete('/items/:sampleId', (req, res) => controller.deleteSample(req, res));

export default router;
