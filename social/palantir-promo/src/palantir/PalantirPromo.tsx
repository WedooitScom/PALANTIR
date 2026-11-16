import { AbsoluteFill, Sequence } from "remotion";
import { Background } from "./Background";
import { Hook } from "./scenes/Hook";
import { TitleReveal } from "./scenes/TitleReveal";
import { ScreenshotShowcase } from "./scenes/ScreenshotShowcase";
import { FeatureList } from "./scenes/FeatureList";
import { CTA } from "./scenes/CTA";
import {
  HOOK_START,
  HOOK_DURATION,
  TITLE_START,
  TITLE_DURATION,
  SHOT_START,
  SHOT_DURATION,
  FEATURES_START,
  FEATURES_DURATION,
  CTA_START,
  CTA_DURATION,
} from "./timeline";

export const PalantirPromo: React.FC = () => {
  return (
    <AbsoluteFill>
      <Background />

      <Sequence name="Hook" from={HOOK_START} durationInFrames={HOOK_DURATION} layout="none">
        <Hook />
      </Sequence>

      <Sequence name="Title reveal" from={TITLE_START} durationInFrames={TITLE_DURATION} layout="none">
        <TitleReveal />
      </Sequence>

      <Sequence name="Screenshot" from={SHOT_START} durationInFrames={SHOT_DURATION} layout="none">
        <ScreenshotShowcase />
      </Sequence>

      <Sequence name="Features" from={FEATURES_START} durationInFrames={FEATURES_DURATION} layout="none">
        <FeatureList />
      </Sequence>

      <Sequence name="CTA" from={CTA_START} durationInFrames={CTA_DURATION} layout="none">
        <CTA />
      </Sequence>
    </AbsoluteFill>
  );
};
