/*!
 * <matrix-button> — reusable button with a 7×7 LED dot-matrix spinner.
 * <matrix-spinner> — the same LED grid on its own, always animating, for
 *                    status indicators (shader compiles, blocking work).
 * No dependencies; they're Web Components. In React use <MatrixButton> from
 * ./MatrixButton.jsx and <MatrixSpinner> from ./MatrixSpinner.jsx, which map
 * boolean props to attributes correctly.
 *
 *   <matrix-button loading-label="Exporting">Export</matrix-button>
 *   <matrix-spinner size="sm" label="Compiling shaders"></matrix-spinner>
 *
 * <matrix-button> attributes
 *   loading            show the spinner + loading label (also: el.loading = true)
 *   loading-label      text shown while loading (defaults to the normal label)
 *   color              LED colour, any CSS colour (default: brand blue #3b82f6)
 *   theme              dark (default) | light | auto (follows the OS setting)
 *   size               xs | sm | md | lg (or set --mb-h yourself)
 *   speed              ms per LED step (default 50 → one lap every 800 ms)
 *   block              stretch to the container width, label centred
 *   disabled
 *
 * <matrix-spinner> attributes
 *   size               xs (12px) | sm (16px, default) | md (24px) | lg (36px),
 *                      or a pixel number such as "14" / "14px"
 *   color              LED colour, any CSS colour (default: brand blue #3b82f6)
 *   speed              ms per LED step (default 50)
 *   minimal            hide the dim inner LEDs; reads better below ~16px
 *   paused             freeze the animation
 *   label              accessible name (role="img"); without it the spinner is
 *                      aria-hidden, so pair it with visible text
 *
 * Methods (button)
 *   el.run(asyncFn)    sets loading, awaits the function / promise, then resets
 *
 * Events (button)
 *   loadingstart / loadingend (bubbling, composed)
 *
 * CSS hooks
 *   --mb-color, --mb-h, --mb-bg, --mb-fg, --mb-hover, --mb-font, --mb-radius
 *   --ms-size (spinner)
 *   ::part(button), ::part(spinner), ::part(label), ::part(grid) (spinner)
 */
(() => {
  if (typeof window === 'undefined' || !window.customElements) return;

  // Clockwise ring around the 7×7 grid (corners removed) — 16 LEDs.
  const RING = [[0,2],[0,3],[0,4],[1,5],[2,6],[3,6],[4,6],[5,5],[6,4],[6,3],[6,2],[5,1],[4,0],[3,0],[2,0],[1,1]];
  const N = RING.length;
  // Brightness of an LED k steps after the head passed it: head + bright tail, long fade.
  const TRAIL = [1, 1, .95, .9, .82, .7, .5, .36, .26, .19, .13, .09, .06, .04, .025, .012];

  const ringIndex = new Map(RING.map(([r, c], i) => [r * 7 + c, i]));
  let cells = '';
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
    const corner = (r === 0 || r === 6) && (c === 0 || c === 6);
    const d = Math.hypot(r - 3, c - 3).toFixed(2);
    if (corner) cells += '<i class="x"></i>';
    else if (ringIndex.has(r * 7 + c)) cells += `<i class="r" style="--i:${ringIndex.get(r * 7 + c)};--d:${d}"></i>`;
    else cells += `<i style="--d:${d}"></i>`;
  }
  // step-end keyframes so each LED holds its value for one tick (crisp LED look).
  const keyframes = TRAIL.map((o, k) => `${(k * 100 / N).toFixed(3)}%{opacity:${o}}`).join('') + `100%{opacity:1}`;

  // Animatable angle for the hover ring's travelling highlight. @property
  // rules inside a shadow root are ignored, so register it globally.
  // --mb-ring-progress drives the "draw the outline" reveal (0 → 360deg).
  for (const name of ['--mb-ring-angle', '--mb-ring-progress']) {
    try {
      CSS.registerProperty({ name, syntax: '<angle>', inherits: false, initialValue: '0deg' });
    } catch { /* already registered (HMR) or unsupported: the ring stays static */ }
  }

  if (!customElements.get('matrix-button')) defineButton();
  if (!customElements.get('matrix-spinner')) defineSpinner();

  function defineButton() {
    // Light palette — used by theme="light", and by theme="auto" when the OS is in light mode.
    const light = `--mb-bg:#ffffff;--mb-fg:#141414;--mb-hover:#f1f1f3;
      --mb-off:10%;--mb-ring-off:18%;--mb-lit:var(--mb-color);--mb-glow-near:55%;--mb-glow:24%;
      --mb-sheen:rgba(0,0,0,.07);
      --mb-shadow:0 1px 0 #fff inset,0 0 0 1px rgba(0,0,0,.07) inset,
        0 1px 2px rgba(0,0,0,.08),0 10px 24px -8px rgba(0,0,0,.22);
      --mb-shadow-hover:0 1px 0 #fff inset,0 0 0 1px rgba(0,0,0,.07) inset,
        0 2px 4px rgba(0,0,0,.14),0 16px 32px -10px rgba(0,0,0,.45),0 0 0 4px rgba(255,255,255,.07);`;

    const css = `
:host{--mb-color:#3b82f6;--mb-h:48px;--mb-speed:50ms;
  --mb-bg:#050505;--mb-fg:#fafafa;--mb-hover:#0f0f0f;
  --mb-off:11%;--mb-ring-off:20%;--mb-lit:color-mix(in srgb,var(--mb-color) 88%,#fff);--mb-glow-near:100%;--mb-glow:50%;
  --mb-shadow:0 1px 0 rgba(255,255,255,.05) inset,0 0 0 1px rgba(255,255,255,.035) inset,
    0 2px 4px rgba(0,0,0,.35),0 12px 28px -6px rgba(0,0,0,.55);
  --mb-shadow-hover:0 1px 0 rgba(255,255,255,.07) inset,0 0 0 1px color-mix(in srgb,var(--mb-color) 30%,transparent) inset,
    0 3px 6px rgba(0,0,0,.4),0 16px 32px -8px rgba(0,0,0,.6);
  --mb-sheen:rgba(255,255,255,.09);
  --mb-ring:#3b82f6;--mb-ring-hi:#bfdbfe;
  --mb-ring-glow:0 0 0 4px rgba(59,130,246,.14),0 10px 28px -8px rgba(59,130,246,.55);
  display:inline-block;vertical-align:middle;-webkit-tap-highlight-color:transparent}
:host([theme=light]){${light}}
@media (prefers-color-scheme:light){:host([theme=auto]){${light}}}
:host([size=xs]){--mb-h:32px}
:host([size=sm]){--mb-h:38px}
:host([size=lg]){--mb-h:60px}
:host([block]){display:block}
:host([hidden]){display:none}
button{all:unset;box-sizing:border-box;position:relative;display:inline-flex;align-items:center;
  height:var(--mb-h);padding:0 calc(var(--mb-h)*.46);border-radius:var(--mb-radius,calc(var(--mb-h)*.36));
  background:var(--mb-bg);color:var(--mb-fg);cursor:var(--cursor-pointer,pointer);white-space:nowrap;user-select:none;
  font:500 calc(var(--mb-h)*.355)/1 var(--mb-font,"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif);
  letter-spacing:-.01em;box-shadow:var(--mb-shadow);
  transition:background .3s cubic-bezier(.22,1,.36,1),color .25s,box-shadow .4s cubic-bezier(.65,0,.35,1),transform .3s cubic-bezier(.22,1,.36,1),padding .4s cubic-bezier(.2,.8,.2,1)}
:host([block]) button{display:flex;width:100%;justify-content:center}
/* Hover: a 1px lift, deeper shadow and a soft sheen sweeping across. */
button::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:linear-gradient(105deg,transparent 35%,var(--mb-sheen) 50%,transparent 65%) no-repeat;
  background-size:250% 100%;background-position:130% 0;opacity:0;
  transition:background-position .8s cubic-bezier(.22,1,.36,1),opacity .35s ease}
button:hover{background:var(--mb-hover);transform:translateY(-1px);box-shadow:var(--mb-shadow-hover,var(--mb-shadow)),var(--mb-ring-glow)}
button:hover::before{opacity:1;background-position:-30% 0}
/* Hover ring: a clean blue stroke that DRAWS itself around the button
   (clockwise from the top-left, via an animated conic mask), then keeps a
   lighter highlight travelling along it. Leaving un-draws it. The stroke is a
   whole 2px: at 1.5px, a button on a fractional y rendered its top edge
   visibly fainter than the rest, so the ring read as incomplete. Mask layers
   (top → bottom): progress sweep ∩ (full box − content box) = partial ring. */
button::after{content:"";position:absolute;inset:-4px;padding:2px;pointer-events:none;
  border-radius:calc(var(--mb-radius,calc(var(--mb-h)*.36)) + 4px);
  background:conic-gradient(from var(--mb-ring-angle),var(--mb-ring) 0deg,var(--mb-ring-hi) 45deg,var(--mb-ring) 95deg,var(--mb-ring) 360deg);
  mask:conic-gradient(from -45deg,#000 var(--mb-ring-progress),transparent 0),
    linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  mask-composite:intersect,exclude;
  --mb-ring-progress:0deg;
  transition:--mb-ring-progress .4s cubic-bezier(.65,0,.35,1);
  animation:mb-ring-spin 2.6s linear infinite paused}
button:hover::after,button:focus-visible::after,:host([selected]) button::after{--mb-ring-progress:360deg;animation-play-state:running}
:host([selected]) button{box-shadow:var(--mb-shadow-hover,var(--mb-shadow)),var(--mb-ring-glow)}
:host([loading]) button::after,:host([disabled]) button::after{opacity:0}
@keyframes mb-ring-spin{to{--mb-ring-angle:360deg}}
button:active{transform:translateY(0) scale(.97);transition-duration:.12s}
:host([loading]) button::before,:host([disabled]) button::before{opacity:0}
button:focus-visible{outline:2px solid color-mix(in srgb,var(--mb-color) 75%,#fff);outline-offset:3px}
:host([loading]) button{cursor:progress;padding-left:calc(var(--mb-h)*.3);transform:none}
:host([block][loading]) button{padding-left:calc(var(--mb-h)*.46)}
:host([disabled]) button{opacity:.45;cursor:not-allowed;transform:none}
::slotted(svg){width:1.1em;height:1.1em;flex:none}
/* Icon ↔ label spacing via gap: host pages may zero margins globally. */
.idle{gap:.45em}

.spin{--s:calc(var(--mb-h)*.47);flex:none;width:0;height:var(--s);margin-right:0;display:flex;
  transition:width .4s cubic-bezier(.2,.8,.2,1),margin .4s cubic-bezier(.2,.8,.2,1)}
:host([loading]) .spin{width:var(--s);margin-right:calc(var(--mb-h)*.24)}
.grid{flex:none;width:var(--s);height:var(--s);display:grid;
  grid-template:repeat(7,1fr)/repeat(7,1fr);gap:calc(var(--s)*.045)}
.grid i{position:relative;border-radius:28%;
  background:color-mix(in srgb,var(--mb-color) var(--mb-off),var(--mb-bg));
  transform:scale(0);opacity:0;
  transition:transform .16s ease-in,opacity .14s ease-in}
.grid i.x{visibility:hidden}
.grid i.r{background:color-mix(in srgb,var(--mb-color) var(--mb-ring-off),var(--mb-bg))}
:host([loading]) .grid i{transform:scale(1);opacity:1;
  transition:transform .38s cubic-bezier(.3,1.7,.5,1) calc(var(--d)*38ms),opacity .2s calc(var(--d)*38ms)}
.grid i.r::after{content:"";position:absolute;inset:0;border-radius:inherit;opacity:0;
  background:var(--mb-lit);
  box-shadow:0 0 calc(var(--s)*.1) color-mix(in srgb,var(--mb-color) var(--mb-glow-near),transparent),
    0 0 calc(var(--s)*.28) color-mix(in srgb,var(--mb-color) var(--mb-glow),transparent)}
:host([loading]) .grid i.r::after{
  animation:mb-trail calc(var(--mb-speed)*${N}) step-end infinite;
  animation-delay:calc(var(--mb-speed)*(var(--i) - ${N}))}
@keyframes mb-trail{${keyframes}}

.labels{display:grid;justify-items:start;align-items:center;overflow:hidden;
  padding-block:.3em;margin-block:-.3em}
.labels.ready{transition:width .4s cubic-bezier(.2,.8,.2,1)}
.labels>span{grid-area:1/1;width:max-content;display:inline-flex;align-items:center;
  transition:opacity .25s,filter .3s,transform .35s cubic-bezier(.2,.8,.2,1)}
.busy,:host([loading]) .idle{opacity:0;filter:blur(4px);transform:translateY(.25em)}
:host([loading]) .busy{opacity:1;filter:none;transform:none}

@media (prefers-reduced-motion:reduce){
  button,.spin,.labels.ready,.labels>span,.grid i,:host([loading]) .grid i{transition-duration:0s!important;transition-delay:0s!important}
  button:hover{transform:none}button::before{display:none}button::after{animation:none;transition:none}
  :host([loading]) .grid i.r::after{animation-duration:calc(var(--mb-speed)*${N * 2.5})}
}`;

    class MatrixButton extends HTMLElement {
      static observedAttributes = ['loading', 'loading-label', 'color', 'speed', 'disabled'];
      #btn; #labels; #idle; #busy; #ro;

      constructor() {
        super();
        const root = this.attachShadow({ mode: 'open', delegatesFocus: true });
        root.innerHTML = `<style>${css}</style><button part="button" type="button">` +
          `<span class="spin" part="spinner" aria-hidden="true"><span class="grid">${cells}</span></span>` +
          `<span class="labels" part="label"><span class="idle"><slot></slot></span><span class="busy" aria-hidden="true"></span></span></button>`;
        this.#btn = root.querySelector('button');
        this.#labels = root.querySelector('.labels');
        this.#idle = root.querySelector('.idle');
        this.#busy = root.querySelector('.busy');
        // Swallow clicks while busy/disabled so host listeners never double-fire.
        this.#btn.addEventListener('click', e => { if (this.loading || this.disabled) e.stopPropagation(); });
        root.querySelector('slot').addEventListener('slotchange', () => this.#syncLabel());
        this.#ro = new ResizeObserver(() => this.#fit());
      }

      connectedCallback() {
        this.#syncLabel();
        this.#ro.observe(this.#idle);
        this.#ro.observe(this.#busy);
        requestAnimationFrame(() => requestAnimationFrame(() => this.#labels.classList.add('ready')));
      }
      disconnectedCallback() { this.#ro.disconnect(); }

      attributeChangedCallback(name, _old, val) {
        if (name === 'color') val ? this.style.setProperty('--mb-color', val) : this.style.removeProperty('--mb-color');
        else if (name === 'speed') val ? this.style.setProperty('--mb-speed', `${parseFloat(val)}ms`) : this.style.removeProperty('--mb-speed');
        else if (name === 'loading-label') this.#syncLabel();
        else if (name === 'disabled') this.#btn.disabled = val !== null;
        else if (name === 'loading') {
          const on = val !== null;
          this.#btn.setAttribute('aria-busy', on);
          this.#btn.setAttribute('aria-disabled', on);
          this.#idle.setAttribute('aria-hidden', on);
          this.#busy.setAttribute('aria-hidden', !on);
          this.#fit();
          this.dispatchEvent(new CustomEvent(on ? 'loadingstart' : 'loadingend', { bubbles: true, composed: true }));
        }
      }

      get loading() { return this.hasAttribute('loading'); }
      set loading(v) { this.toggleAttribute('loading', !!v); }
      get disabled() { return this.hasAttribute('disabled'); }
      set disabled(v) { this.toggleAttribute('disabled', !!v); }

      /** Show the spinner while `task` (a promise or async function) runs. */
      async run(task) {
        if (this.loading) return;
        this.loading = true;
        try { return await (typeof task === 'function' ? task() : task); }
        finally { this.loading = false; }
      }

      #syncLabel() {
        this.#busy.textContent = this.getAttribute('loading-label') ?? this.textContent.trim();
        this.#fit();
      }
      // Animate the label box between the two labels' natural widths.
      #fit() {
        const w = (this.loading ? this.#busy : this.#idle).offsetWidth;
        if (w) this.#labels.style.width = `${w}px`;
      }
    }

    customElements.define('matrix-button', MatrixButton);
  }

  function defineSpinner() {
    // Off-LEDs mix towards transparent so the spinner sits on any surface.
    // --mb-step drives both duration and per-LED delay, so slowing it down for
    // reduced motion keeps the trail shape intact.
    const css = `
:host{--mb-color:#3b82f6;--mb-speed:50ms;--mb-step:var(--mb-speed);--ms-size:16px;
  --mb-off:13%;--mb-ring-off:24%;--mb-lit:color-mix(in srgb,var(--mb-color) 85%,#fff);--mb-glow-near:90%;--mb-glow:42%;
  display:inline-block;flex:none;vertical-align:middle;width:var(--ms-size);height:var(--ms-size);line-height:0}
:host([hidden]){display:none}
:host([size=xs]){--ms-size:12px}
:host([size=sm]){--ms-size:16px}
:host([size=md]){--ms-size:24px}
:host([size=lg]){--ms-size:36px}
.grid{--s:var(--ms-size);width:var(--s);height:var(--s);display:grid;
  grid-template:repeat(7,1fr)/repeat(7,1fr);gap:calc(var(--s)*.05)}
.grid i{position:relative;border-radius:28%;
  background:color-mix(in srgb,var(--mb-color) var(--mb-off),transparent)}
.grid i.x,:host([minimal]) .grid i:not(.r){visibility:hidden}
.grid i.r{background:color-mix(in srgb,var(--mb-color) var(--mb-ring-off),transparent)}
.grid i.r::after{content:"";position:absolute;inset:0;border-radius:inherit;opacity:0;
  background:var(--mb-lit);
  box-shadow:0 0 calc(var(--s)*.1) color-mix(in srgb,var(--mb-color) var(--mb-glow-near),transparent),
    0 0 calc(var(--s)*.26) color-mix(in srgb,var(--mb-color) var(--mb-glow),transparent);
  animation:ms-trail calc(var(--mb-step)*${N}) step-end infinite;
  animation-delay:calc(var(--mb-step)*(var(--i) - ${N}))}
:host([paused]) .grid i.r::after{animation-play-state:paused}
@keyframes ms-trail{${keyframes}}
@media (prefers-reduced-motion:reduce){:host{--mb-step:calc(var(--mb-speed)*2.5)}}`;

    const PX = /^\d+(\.\d+)?(px)?$/;

    class MatrixSpinner extends HTMLElement {
      static observedAttributes = ['size', 'color', 'speed', 'label'];

      constructor() {
        super();
        const root = this.attachShadow({ mode: 'open' });
        root.innerHTML = `<style>${css}</style><span class="grid" part="grid">${cells}</span>`;
      }

      connectedCallback() { this.#syncA11y(); }

      attributeChangedCallback(name, _old, val) {
        if (name === 'color') val ? this.style.setProperty('--mb-color', val) : this.style.removeProperty('--mb-color');
        else if (name === 'speed') val ? this.style.setProperty('--mb-speed', `${parseFloat(val)}ms`) : this.style.removeProperty('--mb-speed');
        else if (name === 'size') val && PX.test(val.trim()) ? this.style.setProperty('--ms-size', `${parseFloat(val)}px`) : this.style.removeProperty('--ms-size');
        else if (name === 'label' && this.isConnected) this.#syncA11y();
      }

      #syncA11y() {
        const label = this.getAttribute('label');
        if (label) {
          this.setAttribute('role', 'img');
          this.setAttribute('aria-label', label);
          this.removeAttribute('aria-hidden');
        } else {
          this.removeAttribute('role');
          this.removeAttribute('aria-label');
          this.setAttribute('aria-hidden', 'true');
        }
      }
    }

    customElements.define('matrix-spinner', MatrixSpinner);
  }
})();
