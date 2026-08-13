import { Comment, h } from 'vue';

function toHtmlString(value) {
  if (Array.isArray(value)) return value.map((item) => toHtmlString(item)).join('');
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return value.html || value.htmlItem || value['html-item'] || String(value);
}

export default {
  name: 'Vector2022RawHtmlFragment',
  props: {
    html: {
      type: [String, Array, Number, Boolean, Object],
      default: ''
    }
  },
  render() {
    return h(Comment, 'legacy-raw-html-fragment');
  },
  mounted() {
    this.syncRawHtmlFragment();
  },
  beforeUnmount() {
    this.clearRawHtmlFragment();
  },
  beforeDestroy() {
    this.clearRawHtmlFragment();
  },
  watch: {
    html: {
      handler() {
        this.syncRawHtmlFragment();
      },
      deep: true
    }
  },
  methods: {
    clearRawHtmlFragment() {
      const nodes = this.__vector2022RawHtmlFragmentNodes || [];
      for (const node of nodes) {
        if (node && node.parentNode) node.parentNode.removeChild(node);
      }
      this.__vector2022RawHtmlFragmentNodes = [];
    },
    syncRawHtmlFragment() {
      this.clearRawHtmlFragment();
      const anchor = this.$el;
      const parent = anchor && anchor.parentNode;
      if (!parent) return;
      const html = toHtmlString(this.html);
      if (!html) return;
      const template = anchor.ownerDocument.createElement('template');
      template.innerHTML = html;
      const nodes = Array.from(template.content.childNodes);
      for (const node of nodes) parent.insertBefore(node, anchor);
      this.__vector2022RawHtmlFragmentNodes = nodes;
    }
  }
};
