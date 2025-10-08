import { ImageResponse } from "next/og";

export const runtime = "edge";
export const revalidate = false;

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

const LOGO_SRC = "https://gepazilla.com/gepazilla-logo.png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "flex-start",
          background:
            "radial-gradient(circle at 20% 15%, rgba(134, 239, 172, 0.25) 0%, rgba(236, 253, 245, 0) 55%), radial-gradient(circle at 80% 85%, rgba(134, 239, 172, 0.25) 0%, rgba(236, 253, 245, 0) 55%), linear-gradient(135deg, #ecfdf5 0%, #ffffff 50%, #d1fae5 100%)",
          color: "#0f172a",
          display: "flex",
          flexDirection: "column",
          gap: "36px",
          height: "100%",
          justifyContent: "center",
          padding: "96px",
          width: "100%",
        }}
      >
        <img
          src={LOGO_SRC}
          alt="GEPAzilla mascot"
          style={{ height: "180px", width: "180px", filter: "drop-shadow(0px 18px 36px rgba(12, 106, 57, 0.3))" }}
        />
        <div style={{ fontSize: "88px", fontWeight: 700, letterSpacing: "-4px", lineHeight: 0.9, color: "#064e3b" }}>
          GEPAzilla
        </div>
        <div style={{ fontSize: "32px", lineHeight: 1.3, maxWidth: "720px", opacity: 0.85 }}>
          Open-source GEPA prompt optimizer with scoring, telemetry, and reflection in one console.
        </div>
      </div>
    ),
    {
      width: size.width,
      height: size.height,
    },
  );
}
