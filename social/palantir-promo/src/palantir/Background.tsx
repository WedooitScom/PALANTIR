import { AbsoluteFill, Interactive, interpolate, useCurrentFrame } from "remotion";
import { theme, W } from "./theme";

const STAR_DOTS = [
  [10, 14], [78, 8], [55, 22], [30, 30], [85, 34], [18, 42], [66, 46],
  [40, 50], [92, 56], [8, 60], [72, 64], [48, 70], [25, 76], [60, 80],
  [14, 86], [88, 90],
];

const FLICKER_PERIOD = 48; // ~1.6s at 30fps, matches the web beacon's flicker

const flicker = (frame: number) => {
  const local = frame % FLICKER_PERIOD;
  const scale = interpolate(
    local,
    [0, FLICKER_PERIOD * 0.45, FLICKER_PERIOD * 0.7, FLICKER_PERIOD],
    [1, 0.88, 1.06, 1],
  );
  const opacity = interpolate(
    local,
    [0, FLICKER_PERIOD * 0.45, FLICKER_PERIOD * 0.7, FLICKER_PERIOD],
    [1, 0.85, 1, 1],
  );
  return { scale, opacity };
};

export const Background: React.FC<{ showBeacon?: boolean }> = ({ showBeacon = true }) => {
  const frame = useCurrentFrame();
  const flame = flicker(frame);

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse 140% 60% at 50% -5%, ${theme.sky2}, ${theme.sky} 65%)`,
      }}
    >
      <Interactive.Div name="Stars" style={{ position: "absolute", inset: 0 }}>
        {STAR_DOTS.map(([x, y], i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${x}%`,
              top: `${y}%`,
              width: i % 3 === 0 ? 5 : 3,
              height: i % 3 === 0 ? 5 : 3,
              borderRadius: "50%",
              background: i % 2 === 0 ? theme.parch3 : theme.inkSoft,
              opacity: 0.75,
            }}
          />
        ))}
      </Interactive.Div>

      {showBeacon && (
        <Interactive.Div
          name="Beacon skyline"
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            width: W,
            height: 260,
          }}
        >
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: 170,
              opacity: 0.95,
              background:
                `linear-gradient(135deg, transparent 49%, ${theme.edge} 50%) 0 100%/90px 170px repeat-x,` +
                `linear-gradient(225deg, transparent 49%, ${theme.edge} 50%) 45px 100%/90px 170px repeat-x`,
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: "50%",
              translate: "-50% 0",
              width: 34,
              height: 150,
              background: theme.edge,
              clipPath:
                "polygon(20% 100%, 20% 30%, 0% 30%, 50% 0%, 100% 30%, 80% 30%, 80% 100%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 150,
              left: "50%",
              translate: "-50% 0",
              scale: flame.scale,
              opacity: flame.opacity,
              width: 18,
              height: 28,
              borderRadius: "50% 50% 50% 50% / 60% 60% 40% 40%",
              background: `radial-gradient(circle at 50% 70%, ${theme.gold}, ${theme.hot} 70%, transparent 100%)`,
              boxShadow: `0 0 28px 10px rgba(224,50,31,0.5)`,
            }}
          />
        </Interactive.Div>
      )}
    </AbsoluteFill>
  );
};
