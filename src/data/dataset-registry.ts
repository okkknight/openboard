import { readdir, realpath } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import type { DatasetFormat, DatasetSpec } from "../core/types.js";

const formats: Record<string, DatasetFormat | undefined> = { ".csv": "csv", ".parquet": "parquet" };

function datasetId(relativePath: string): string {
  return relativePath.slice(0, -extname(relativePath).length).split(sep).join("__");
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== "" && !path.startsWith(`..${sep}`) && path !== "..";
}

/** Re-resolves persisted dataset paths before a restored scene may use them. */
export async function validateDatasetsInsideRoot(root: string, datasets: Record<string, DatasetSpec>): Promise<Record<string, DatasetSpec>> {
  const resolvedRoot = await realpath(root);
  const validated: Record<string, DatasetSpec> = {};
  for (const [id, dataset] of Object.entries(datasets)) {
    const resolvedPath = await realpath(dataset.path);
    if (!isInside(resolvedRoot, resolvedPath)) throw new Error(`dataset_path_outside_root: ${dataset.path}`);
    validated[id] = { ...dataset, path: resolvedPath };
  }
  return validated;
}

export class DatasetRegistry {
  async discover(root: string): Promise<DatasetSpec[]> {
    const resolvedRoot = await realpath(root);
    const datasets: DatasetSpec[] = [];
    await this.#scan(resolvedRoot, resolvedRoot, datasets);
    return datasets.sort((left, right) => left.id.localeCompare(right.id));
  }

  async #scan(root: string, directory: string, datasets: DatasetSpec[]): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await this.#scan(root, path, datasets);
        continue;
      }
      if (!entry.isFile()) continue;
      const format = formats[extname(entry.name).toLowerCase()];
      if (!format) continue;
      const resolvedPath = await realpath(path);
      if (!isInside(root, resolvedPath)) throw new Error(`dataset_path_outside_root: ${path}`);
      const pathFromRoot = relative(root, resolvedPath);
      datasets.push({ id: datasetId(pathFromRoot), path: resolvedPath, format });
    }
  }
}
