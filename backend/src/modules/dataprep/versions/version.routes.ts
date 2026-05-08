import express from 'express';
import { DataPrepVersionController } from './version.controller';

const router = express.Router();
const controller = new DataPrepVersionController();

router.post('/', (req, res) => controller.createVersion(req, res));
router.get('/:id', (req, res) => controller.getVersion(req, res));
router.delete('/:id', (req, res) => controller.deleteVersion(req, res));
router.post('/:id/checkpoints/classification-balance', (req, res) => controller.createClassificationBalanceCheckpoint(req, res));
router.post('/:id/checkpoints/evaluation-filter', (req, res) => controller.createEvaluationFilterCheckpoint(req, res));
router.post('/:id/checkpoints/refine-accept', (req, res) => controller.createRefineAcceptCheckpoint(req, res));
router.patch('/:id/prepare-progress', (req, res) => controller.updatePrepareProgress(req, res));
router.patch('/:id/visibility', (req, res) => controller.updateVisibility(req, res));
router.patch('/:id/share', (req, res) => controller.updateSharing(req, res));
router.get('/:id/assignments', (req, res) => controller.getAssignments(req, res));
router.get('/:id/assignments/users/:userId/detail', (req, res) => controller.getUserAssignmentDetail(req, res));
router.get('/:id/assignments/me/status', (req, res) => controller.getMyAssignmentStatus(req, res));
router.post('/:id/assignments/me/submit', (req, res) => controller.submitMyAssignment(req, res));
router.post('/:id/assignments/range', (req, res) => controller.assignRange(req, res));
router.post('/:id/assignments/users/:userId/approve', (req, res) => controller.approveUserAssignment(req, res));
router.delete('/:id/assignments/range', (req, res) => controller.clearAssignmentRange(req, res));
router.delete('/:id/assignments/users/:userId', (req, res) => controller.clearUserAssignments(req, res));
router.delete('/items/:sampleId', (req, res) => controller.deleteSample(req, res));

export default router;
