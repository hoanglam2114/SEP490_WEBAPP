import express from 'express';
import { addLabel, getLabelsBySample, removeLabel, voteLabel } from '../controllers/labelController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = express.Router();

// All label endpoints are protected.
router.use(authMiddleware);

router.get('/:sampleId', getLabelsBySample);
router.post('/:sampleId/add', addLabel);
router.delete('/:sampleId/remove', removeLabel);
router.post('/:labelId/vote', voteLabel);

export default router;
