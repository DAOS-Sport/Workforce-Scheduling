/**
 * server/infra/line/lineSignature.ts
 *
 * LINE webhook signature verification — canonical infra-layer re-export.
 * The actual implementation lives in server/modules/line/lineSignature.ts.
 * This file provides the infra/ path for new code while keeping backward
 * compatibility for existing importers of the modules/ path.
 */
export {
  isValidLineUserId,
  verifyLineSignature,
  verifyForwardedRequest,
} from "../../modules/line/lineSignature";
