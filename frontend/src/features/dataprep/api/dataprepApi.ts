import { apiService } from '../../../services/api';

export const dataprepApi = {
  createDatasetVersion: apiService.createDatasetVersion,
  getDatasetVersionDetail: apiService.getDatasetVersionDetail,
  deleteDatasetVersionItem: apiService.deleteDatasetVersionItem,
  updateDatasetVersionVisibility: apiService.updateDatasetVersionVisibility,
  updateDatasetVersionSharing: apiService.updateDatasetVersionSharing,
  getPublicProjectLabeling: apiService.getPublicProjectLabeling,
  getPublicProjectsHub: apiService.getPublicProjectsHub,
  getSampleLabels: apiService.getSampleLabels,
  addSampleLabel: apiService.addSampleLabel,
  voteSampleLabel: apiService.voteSampleLabel,
  previewMessageAutoLabels: apiService.previewMessageAutoLabels,
  saveMessageAutoLabels: apiService.saveMessageAutoLabels,
  previewAutoLabels: apiService.previewAutoLabels,
  saveAutoLabels: apiService.saveAutoLabels,
  clusterVersion: apiService.clusterVersion,
  clusterVersionFilter: apiService.clusterVersionFilter,
  clusterVersionRemoveNoise: apiService.clusterVersionRemoveNoise,
  clusterVersionDeduplicate: apiService.clusterVersionDeduplicate,
  clusterVersionVisualize: apiService.clusterVersionVisualize,
  deleteClusterCache: apiService.deleteClusterCache,
};

export type DataprepApi = typeof dataprepApi;
