/**
 * Worked cases for the judgements that come up again and again. The question is whether the
 * claim reads the post correctly, not whether the post is true - so the examples keep the two apart.
 */
const ANSWER_EXAMPLES: { claim: string; post: string; answer: string; why: string }[] = [
  {
    claim: "Engagement speed = faster",
    post: "…engages targets faster than its predecessor",
    answer: "No",
    why: "A comparison is not a value: no figure can be read, compared or converted from it. The same goes for “improved”, “high”, “long-range”.",
  },
  {
    claim: "Cruise speed = (approximately 46 km/h",
    post: "cruises at 25 knots (approximately 46 km/h)",
    answer: "Yes",
    why: "Same speed, the post's own conversion. A stray bracket is a clean-up slip, not a misread.",
  },
  {
    claim: "Speed = 40",
    post: "speeds around 40 knots",
    answer: "Yes, if the reading shows knots",
    why: "Judge the value with its unit. If the unit is missing or wrong (40 km/h for 40 knots), answer No.",
  },
  {
    claim: "Endurance = 30 хвилин",
    post: "(a Ukrainian post)",
    answer: "Translate, then judge",
    why: "Press Translate and tick “read through a translation”; can't tell only if the translation does not settle it. Units: хвилин/хв, минут/мин = minutes · годин/год, часов/ч = hours · км/год, км/ч = km/h · вузлів, узлов = knots.",
  },
  {
    claim: "Contra · Radome = large circular radome",
    post: "the KJ-3000 carries a large circular radome",
    answer: "No",
    why: "Right fact, wrong system. The claim is filed under the system the post names, or it is wrong.",
  },
  {
    claim: "PAC-3 Edge · New seeker",
    post: "PAC-3 MSE incorporates a new seeker",
    answer: "No",
    why: "A parent, a sibling variant and the variant itself are three systems here. A statement about PAC-3 MSE is not one about PAC-3 Edge or PAC-3 ACE unless the sentence says it covers them (“MSE, Edge and ACE share…”). Same for a pod and the aircraft that carries it.",
  },
  {
    claim: "Detection range = 12 km",
    post: "detects light vehicles at more than 12 km",
    answer: "No",
    why: "A bound is not a point. Yes only when the reading keeps it (“more than 12 km”, “up to 7 hours”) and the post says it of this attribute - here it is also another target than the attribute names.",
  },
  {
    claim:
      "Unit cost = “…less than $1 million per unit, range up to 1,500 km, warhead up to 200 kg”",
    post: "declared a cost of less than $1 million per unit, range up to 1,500 km…",
    answer: "No",
    why: "A value carrying other attributes' figures cannot be read. With only “less than $1 million per unit” the same fact is a Yes - a stray bracket or word is a clean-up slip, other figures are a misread.",
  },
  {
    claim: "Maximum altitude = 100 km",
    post: "engages targets up to 100 km",
    answer: "No",
    why: "A distance or height of the target, or an engagement range, is not the system's own altitude. Check whose figure it is and what it measures.",
  },
  {
    claim: "Quantity deployed = 2 · Missiles received = 800 · Unit price = $2.1 billion",
    post: "two UAVs struck the town · fired more than 800 · approves a $2.1 billion sale",
    answer: "No",
    why: "An event or a total is not the property: strikes are not deployments, fired is not received, a deal's total is not a unit price.",
  },
  {
    claim: "Max speed = 4,000 km/h (small quadcopter)",
    post: "reaches 4,000 km/h",
    answer: "Yes + “plainly wrong”",
    why: "Read correctly, but the post itself cannot be right. The tick records that apart from the reading.",
  },
  {
    claim: "Range = 300 km",
    post: "(post not archived, no quote)",
    answer: "Can't tell",
    why: "Only when nothing in front of you settles it - not as a way to skip a hard one.",
  },
];

export function AnswerGuide() {
  return (
    <details className="border-t border-border pt-3 text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        How to answer - examples
      </summary>
      <p className="mt-2 text-muted-foreground">
        You are judging the reading, not the post: Yes when the post states this value, with this
        unit, for this attribute of this system.
      </p>
      <ul className="mt-2 space-y-2">
        {ANSWER_EXAMPLES.map((ex) => (
          <li key={ex.claim} className="space-y-0.5">
            <p>
              <span className="font-mono">{ex.claim}</span>{" "}
              <span className="text-muted-foreground">← “{ex.post}”</span>
            </p>
            <p>
              <span className="font-semibold">{ex.answer}.</span>{" "}
              <span className="text-muted-foreground">{ex.why}</span>
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}
