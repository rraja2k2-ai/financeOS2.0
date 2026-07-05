import type { CaptureFile } from "./capture-file";
import type { Status } from "./capture-enums";

export type CaptureSession = {
  capture_id: string;
  files: CaptureFile[];
  status: Status;
};
