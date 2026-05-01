import express from 'express';
import { exportController } from './export.controller';

const router = express.Router();

router.get('/:versionId', exportController.downloadDataset);

export default router;
