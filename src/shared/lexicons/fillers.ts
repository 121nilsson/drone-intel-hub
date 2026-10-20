/**
 * Function words that never carry a cue or a trigger on their own.
 *
 * A corpus rather than copy: these are the words a hypothesis miner must not build a pattern
 * from, in every language this repo ingests. It lives here, with the other language data, so
 * it is not mistaken for something a reader sees.
 */
export const FILLER_WORDS: ReadonlySet<string> = new Set(
  (
    "the of with and for from that this has have its was were are can will about over than " +
    "max maximum min minimum approximately around nearly some more less into like also which " +
    "upto till until reach reaches reaching distance distances " +
    "до від на по при для около порядка більше более менее менше понад свыше " +
    "och med för upp till från cirka"
  ).split(" "),
);
