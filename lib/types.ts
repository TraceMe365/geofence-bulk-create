export interface Zone {
  name: string;
  lat: number;
  lng: number;
  radius: number;
}

export interface BatchEvent {
  type: "status" | "batch" | "done" | "error";
  message?: string;
  batchIndex?: number;
  totalBatches?: number;
  batchCreated?: number;
  batchFailed?: number;
  createdSoFar?: number;
  failedSoFar?: number;
  created?: number;
  failed?: number;
  total?: number;
  failures?: { name: string; error: unknown }[];
}
