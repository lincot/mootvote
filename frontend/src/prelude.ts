import { Buffer } from "buffer";

(globalThis as any).Buffer ??= Buffer;
(globalThis as any).exports ??= { __esModule: true };
