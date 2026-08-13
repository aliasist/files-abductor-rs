import { useEffect, useRef } from "react";
import { gsap } from "gsap";

interface SplashProps {
  status: string;
  onComplete: () => void;
}

// Cinematic UFO abduction sequence, timeline-driven with GSAP instead of the
// original's plain CSS keyframes — lets us sequence beam-charge → cow-lift →
// fade-out as one coordinated shot instead of independently-looping animations.
export default function Splash({ status, onComplete }: SplashProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const ufoRef = useRef<HTMLDivElement>(null);
  const beamRef = useRef<HTMLDivElement>(null);
  const cowRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const starsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tl = gsap.timeline({
      onComplete: () => {
        gsap.to(rootRef.current, {
          opacity: 0,
          duration: 0.6,
          ease: "power2.inOut",
          onComplete,
        });
      },
    });

    // Stars twinkle in first, establishing depth
    tl.from(starsRef.current?.children ?? [], {
      opacity: 0,
      scale: 0,
      duration: 0.4,
      stagger: 0.04,
      ease: "back.out(2)",
    });

    // UFO descends from off-screen with a slight wobble
    tl.from(
      ufoRef.current,
      {
        y: -220,
        rotation: -8,
        opacity: 0,
        duration: 1.1,
        ease: "power3.out",
      },
      "-=0.2",
    );
    tl.to(ufoRef.current, {
      rotation: 3,
      duration: 1.4,
      ease: "sine.inOut",
      repeat: 1,
      yoyo: true,
    });

    // Beam charges up (scaleY from 0), then the cow lifts into it
    tl.fromTo(
      beamRef.current,
      { scaleY: 0, opacity: 0 },
      { scaleY: 1, opacity: 1, duration: 0.5, ease: "power2.out", transformOrigin: "top" },
      "-=0.6",
    );
    tl.to(
      cowRef.current,
      {
        y: -140,
        opacity: 0,
        rotation: 15,
        duration: 1.6,
        ease: "power1.in",
      },
      "-=0.1",
    );

    // Title punches in once the abduction lands
    tl.from(
      titleRef.current,
      {
        opacity: 0,
        y: 24,
        scale: 0.9,
        duration: 0.6,
        ease: "back.out(1.7)",
      },
      "-=0.8",
    );

    // Hold on the finished scene before handing off to the main app
    tl.to({}, { duration: 1.1 });

    return () => {
      tl.kill();
    };
  }, [onComplete]);

  return (
    <div ref={rootRef} className="splash">
      <div className="splash-content">
        <div ref={starsRef} className="stars">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="star"
              style={{
                top: `${5 + Math.random() * 35}%`,
                left: `${8 + Math.random() * 84}%`,
              }}
            />
          ))}
        </div>

        <div className="ufo-scene">
          <div ref={ufoRef} className="ufo">
            <div className="ufo-dome" />
            <div className="ufo-body">
              <div className="ufo-light" />
              <div className="ufo-light" />
              <div className="ufo-light" />
            </div>
          </div>
          <div ref={beamRef} className="beam" />
          <div ref={cowRef} className="cow">
            <div className="cow-body" />
            <div className="cow-head" />
            <div className="cow-spots" />
            <div className="cow-legs">
              <div className="leg" />
              <div className="leg" />
              <div className="leg" />
              <div className="leg" />
            </div>
          </div>
          <div className="ground" />
        </div>

        <h1 ref={titleRef} className="splash-title">
          ALIASIST
        </h1>
        <p className="splash-sub">F I L E S &nbsp; A B D U C T O R</p>
        <p className="splash-credit">coded by dev_aliasist · www.aliasist.com</p>
        <p className="splash-status">{status}</p>
      </div>
    </div>
  );
}
