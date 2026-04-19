import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface DatasetMetadata {
  projectName?: string;
  datasetVersionId?: string;
  datasetVersionName?: string;
  systemPrompt?: string;
  systemPromptVersion?: string;
  totalTrain?: number;
  totalTest?: number;
  exportedAt?: string;
}

export interface ZipExtractionResult {
  /** Path to the extracted data file (train or test JSON) */
  dataFilePath: string;
  /** Original filename of the data file inside the ZIP */
  dataFileName: string;
  /** Parsed metadata from _metadata.json, or null if not found */
  metadata: DatasetMetadata | null;
  /** Temporary directory created for extraction (caller should clean up) */
  tempDir: string;
}

/**
 * Check if a file is a ZIP archive based on extension.
 */
export function isZipFile(filename: string): boolean {
  return path.extname(filename).toLowerCase() === '.zip';
}

/**
 * Extract a ZIP file uploaded for Training.
 * Looks for `train_dataset.json` as the primary data file,
 * and `_metadata.json` for traceability info.
 *
 * If no `train_dataset.json` is found, falls back to the first `.json`/`.jsonl` file.
 */
export function extractForTraining(zipFilePath: string): ZipExtractionResult {
  return extractZip(zipFilePath, 'train');
}

/**
 * Extract a ZIP file uploaded for Model Evaluation.
 * Looks for `test_dataset.json` as the primary data file,
 * and `_metadata.json` for traceability info.
 *
 * If no `test_dataset.json` is found, falls back to the first `.json`/`.jsonl` file.
 */
export function extractForEvaluation(zipFilePath: string): ZipExtractionResult {
  return extractZip(zipFilePath, 'test');
}

function extractZip(zipFilePath: string, mode: 'train' | 'test'): ZipExtractionResult {
  const zip = new AdmZip(zipFilePath);
  const entries = zip.getEntries();

  // Create a temp directory for extraction
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dataset-zip-'));

  // 1. Look for _metadata.json
  let metadata: DatasetMetadata | null = null;
  const metadataEntry = entries.find(
    (e) => !e.isDirectory && path.basename(e.entryName) === '_metadata.json'
  );
  if (metadataEntry) {
    try {
      const metadataContent = metadataEntry.getData().toString('utf-8');
      metadata = JSON.parse(metadataContent) as DatasetMetadata;
    } catch (err) {
      console.warn('[ZipService] Failed to parse _metadata.json:', err);
    }
  }

  // 2. Look for data file
  const preferredName = mode === 'train' ? 'train_dataset.json' : 'test_dataset.json';

  let dataEntry = entries.find(
    (e) => !e.isDirectory && path.basename(e.entryName) === preferredName
  );

  // Fallback: find any .json or .jsonl file that isn't _metadata.json
  if (!dataEntry) {
    dataEntry = entries.find((e) => {
      if (e.isDirectory) return false;
      const basename = path.basename(e.entryName);
      if (basename === '_metadata.json') return false;
      const ext = path.extname(basename).toLowerCase();
      return ext === '.json' || ext === '.jsonl';
    });
  }

  if (!dataEntry) {
    // Cleanup temp dir on failure
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw new Error(
      `ZIP file does not contain a valid dataset file. Expected '${preferredName}' or any .json/.jsonl file.`
    );
  }

  // 3. Extract data file to temp directory
  const dataFileName = path.basename(dataEntry.entryName);
  const dataFilePath = path.join(tempDir, dataFileName);
  fs.writeFileSync(dataFilePath, dataEntry.getData());

  return {
    dataFilePath,
    dataFileName,
    metadata,
    tempDir,
  };
}

/**
 * Cleanup the temporary directory created during extraction.
 */
export function cleanupTempDir(tempDir: string): void {
  try {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn('[ZipService] Failed to cleanup temp dir:', tempDir, err);
  }
}
