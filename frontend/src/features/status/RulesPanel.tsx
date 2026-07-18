/**
 * The rules, in full. All three of them.
 *
 * Static by design: if the rules needed explaining beyond this, there would be
 * too many of them. The cooldown line names the server on purpose — a player who
 * knows the rule isn't in their browser doesn't waste time trying to beat it.
 */
export function RulesPanel() {
  return (
    <section className="panel hint">
      <h2>How it works</h2>
      <ul className="rules">
        <li>
          <b>Empty tile</b>: click it, it's yours.
        </li>
        <li>
          <b>Someone's tile</b>: click it, find the odd shape, take it.
        </li>
        <li>
          <b>Four charges</b>, one back every 1.2s. Burst when you need to; the
          server counts them, not your browser.
        </li>
      </ul>
    </section>
  );
}
