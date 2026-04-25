import express from 'express';
import projectRoutes from '../modules/dataprep/projects/project.routes';
import versionRoutes from '../modules/dataprep/versions/version.routes';
import labelingRoutes from '../modules/dataprep/labeling/labeling.routes';
import { preprocessingRouter, versionPreprocessingRouter } from '../modules/dataprep/preprocessing/preprocessing.routes';
import exportRoutes from '../modules/dataprep/export/export.routes';
import autoLabelRoutes from '../modules/dataprep/auto-label/autoLabel.routes';

const router = express.Router();

router.use('/projects', projectRoutes);
router.use('/versions', versionRoutes);
router.use('/versions/:versionId/auto-label', autoLabelRoutes);
router.use('/versions/:versionId/preprocessing', versionPreprocessingRouter);
router.use('/preprocessing', preprocessingRouter);
router.use('/export', exportRoutes);
router.use('/', labelingRoutes);

export default router;
