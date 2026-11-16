import { Composition } from "remotion";
import { PalantirPromo } from "./palantir/PalantirPromo";
import { TOTAL_DURATION } from "./palantir/timeline";

export const MyComposition = () => {
  return (
    <Composition
      id="PalantirPromo"
      component={PalantirPromo}
      durationInFrames={TOTAL_DURATION}
      fps={30}
      width={1080}
      height={1920}
    />
  );
};
