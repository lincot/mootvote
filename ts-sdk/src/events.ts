import { IdlEvents } from "@coral-xyz/anchor";
import { Mootvote } from "./idl/mootvote";
import { getProgram } from "./program";
import { ConfirmedTransactionMeta } from "@solana/web3.js";
import { PROGRAM_ID } from "./constants";

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

export const getVoteEvents = (
  logs: string[],
): VoteEvent[] => {
  return getEvents("voteEvent", logs);
};

const INVOKE_RE = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[\d+\]$/;
const SUCCESS_RE = /^Program [1-9A-HJ-NP-Za-km-z]+ (success|failed)$/;

function getEvents<E extends keyof IdlEvents<Mootvote>>(
  eventName: E,
  logs: string[],
): IdlEvents<Mootvote>[E][] {
  const coder = getProgram().coder;
  const programIdStr = PROGRAM_ID.toString();
  const results = [];
  const stack: string[] = [];

  for (const log of logs) {
    const invokeMatch = INVOKE_RE.exec(log);
    if (invokeMatch) {
      stack.push(invokeMatch[1]);
      continue;
    }
    if (SUCCESS_RE.test(log)) {
      stack.pop();
      continue;
    }
    if (
      log.startsWith("Program data: ") &&
      stack[stack.length - 1] === programIdStr
    ) {
      const event = coder.events.decode(log.slice("Program data: ".length));
      if (event && event.name === eventName) {
        results.push(event.data);
      }
    }
  }

  return results;
}
