"use client";

export default function HowToPlay({ onStart }: { onStart: () => void }) {
  return (
    <div className="overlay">
      <div className="modal">
        <h1>
          THINGS <em>vs</em> STUFF
        </h1>
        <div className="rule">
          <span className="n">1.</span>
          <span>
            ✏️ <b>INVENT literally anything</b> — a moat of soup, a very judgmental owl. Nothing
            comes pre-made: every THING you fight with is one you typed. Each gets sized up and
            priced on the spot.
          </span>
        </div>
        <div className="rule">
          <span className="n">2.</span>
          <span>
            Read the dots before you buy: <span className="dot-demo g" /> strong ·{" "}
            <span className="dot-demo y" /> meh · <span className="dot-demo r" /> useless ·{" "}
            <span className="dot-demo p" /> <b>feeds them!</b> Prices match power — bargains
            exist.
          </span>
        </div>
        <div className="rule">
          <span className="n">3.</span>
          <span>
            Drag THINGS onto the paper to stop the STUFF from reaching your 🏠.
          </span>
        </div>
        <div className="rule">
          <span className="n">4.</span>
          <span>
            Drop one thing onto another to <b style={{ color: "var(--purple)" }}>FUSE</b> —{" "}
            <i>how</i> they combine changes what they become.
          </span>
        </div>
        <div className="fineprint">
          fresh stuff every day · everyone gets the same board · 🎲 free play for endless
          new boards
          <span style={{ display: "block", marginTop: 4, fontSize: 12, opacity: 0.75 }}>
            icons by{" "}
            <a href="https://openmoji.org" target="_blank" rel="noreferrer">
              OpenMoji
            </a>{" "}
            (CC BY-SA 4.0)
          </span>
        </div>
        <div className="btn-row">
          <button className="sketch-btn primary" onClick={onStart}>
            ▶ LET&apos;S GO
          </button>
        </div>
      </div>
    </div>
  );
}
