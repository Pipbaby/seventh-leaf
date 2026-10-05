// A long list or grid that keeps only the rows in view (and a few more) in the page, so ten
// thousand items scroll as smoothly as ten. Cells that scroll out of view are reused.
const MARGIN = 3; // rows kept above and below the view

export class VirtualList {
  // box: the list's own element; scroller: the element that scrolls it.
  // height(cellWidth) → cell height; make() → a new, empty cell; render(i, cell) fills a cell for
  // item i; onrange(from, to) hears which items are in view whenever that changes.
  constructor(box, scroller, { columns = 1, gap = 0, height, make, render, onrange }) {
    Object.assign(this, { box, scroller, columns, gap, height, make, render, onrange });
    this.count = 0;
    this.cells = new Map(); // item index → cell
    this.spare = [];
    this.range = [0, 0];
    box.style.position = 'relative';
    let queued = false;
    const queue = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        this.layout();
      });
    };
    scroller.addEventListener('scroll', queue, { passive: true });
    new ResizeObserver(queue).observe(scroller); // also when its tab is shown
  }

  setCount(n) {
    this.count = n;
    this.layout(true);
  }

  // all: fill the cells in view again, even those already showing their item
  layout(all) {
    const { box, scroller, columns, gap } = this;
    const width = box.clientWidth;
    if (!width) {
      // hidden: forget what was shown, so it is filled afresh when it is shown again
      for (const c of this.cells.values()) c.remove(), this.spare.push(c);
      this.cells.clear();
      this.range = [0, 0];
      return;
    }
    const cw = (width - gap * (columns - 1)) / columns;
    const ch = this.height(cw);
    const step = ch + gap;
    const rows = Math.ceil(this.count / columns);
    box.style.height = rows ? rows * step - gap + 'px' : '0';
    const top = scroller.getBoundingClientRect().top - box.getBoundingClientRect().top;
    const r0 = Math.max(0, Math.floor(top / step) - MARGIN);
    const r1 = Math.min(rows, Math.ceil((top + scroller.clientHeight) / step) + MARGIN);
    const from = Math.min(this.count, r0 * columns);
    const to = Math.max(from, Math.min(this.count, r1 * columns));
    for (const [i, c] of this.cells) {
      if (i >= from && i < to) continue;
      c.remove();
      this.spare.push(c);
      this.cells.delete(i);
    }
    for (let i = from; i < to; i++) {
      let c = this.cells.get(i);
      const fresh = !c;
      if (fresh) {
        c = this.spare.pop() || this.make();
        this.cells.set(i, c);
        box.append(c);
      }
      const s = c.style;
      s.position = 'absolute';
      s.left = (i % columns) * (cw + gap) + 'px';
      s.top = Math.floor(i / columns) * step + 'px';
      s.width = cw + 'px';
      s.height = ch + 'px';
      if (fresh || all) this.render(i, c);
    }
    if (all || from !== this.range[0] || to !== this.range[1]) {
      this.range = [from, to];
      this.onrange?.(from, to);
    }
  }
}
