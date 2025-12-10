import { IdlEvents } from "@coral-xyz/anchor";
import { Mootvote } from "./idl/mootvote";
import { getProgram } from "./program";

export type VoteEvent = IdlEvents<Mootvote>["voteEvent"];

export const onVote = (
  cb: (e: VoteEvent, slot: number, signature: string) => void,
): () => void => {
  return onEvent("voteEvent", cb);
};

function onEvent<E extends keyof IdlEvents<Mootvote>>(
  eventName: E,
  cb: (e: IdlEvents<Mootvote>[E], slot: number, signature: string) => void,
): () => void {
  const prog = getProgram();
  const id = prog.addEventListener(eventName, cb);
  return () => prog.removeEventListener(id);
}
