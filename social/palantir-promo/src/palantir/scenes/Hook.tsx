import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { theme, SAFE_X } from "../theme";
import { bodyFont } from "../fonts";
import { HOOK_DURATION } from "../timeline";

const EASE = Easing.bezier(0.16, 1, 0.3, 1);

const Line: React.FC<{ children: React.ReactNode; delay: number; size: number; color: string }> = ({
  children,
  delay,
  size,
  color,
}) => {
  const frame = useCurrentFrame();
  const local = frame - delay;
  const opacity = interpolate(local, [0, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const translate = interpolate(local, [0, 18], [34, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });

  return (
    <div
      style={{
        fontFamily: bodyFont,
        fontSize: size,
        lineHeight: 1.15,
        color,
        textAlign: "center",
        opacity,
        translate: `0 ${translate}px`,
      }}
    >
      {children}
    </div>
  );
};

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const fadeOut = interpolate(frame, [HOOK_DURATION - 18, HOOK_DURATION], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        opacity: fadeOut,
      }}
    >
      <Interactive.Div
        name="Hook text"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 18,
          paddingInline: SAFE_X,
        }}
      >
        <Line delay={0} size={54} color={theme.parch3}>
          Et si tes agents
        </Line>
        <Line delay={10} size={54} color={theme.parch3}>
          Claude Code
        </Line>
        <Line delay={24} size={58} color={theme.gold}>
          vivaient une épopée ?
        </Line>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
