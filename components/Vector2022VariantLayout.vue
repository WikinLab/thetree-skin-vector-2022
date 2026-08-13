<template>
  <div
    :class="rootClassList"
    :lang="documentEnvironment.htmlAttributes.lang"
    :dir="documentEnvironment.htmlAttributes.dir"
    :data-tt-skin-variant="skinVariantId"
  >
    <SkinVector2022><nuxt /></SkinVector2022>
  </div>
</template>

<style src="../css/vendor/resource-loader/page-styles.css"></style>
<style src="../css/vector-2022-adapter.css"></style>
<style src="../css/host-content.css"></style>
<style src="../css/host-modal.css"></style>

<script>
import SkinVector2022 from './SkinVector2022.vue';
import { makeVector2022TheTreeContext } from '../lib/vector2022TheTreeAdapter.js';
import {
  applyVector2022DocumentEnvironment,
  makeVector2022DocumentEnvironment
} from '../lib/vector2022DocumentEnvironment.js';
import { SKIN_VARIANT_ID } from '../lib/skinVariant.js';

export default {
  name: 'TheTreeVector2022VariantLayout',
  components: { SkinVector2022 },
  data() { return { cleanup: null, skinVariantId: SKIN_VARIANT_ID }; },
  head() {
    return {
      htmlAttrs: { ...this.documentEnvironment.htmlAttributes, class: this.documentEnvironment.htmlClasses.join(' ') },
      bodyAttrs: { class: this.documentEnvironment.bodyClasses.join(' ') }
    };
  },
  computed: {
    adapterContext() {
      return makeVector2022TheTreeContext({ storeState: this.$store.state, route: this.$route });
    },
    documentEnvironment() {
      const context = this.adapterContext;
      const config = context.config || {};
      return makeVector2022DocumentEnvironment({
        lang: config.lang || config['wiki.lang'] || 'ko',
        dir: config.dir || config['wiki.dir'] || 'ltr',
        namespace: context.pageContract.namespaceId,
        action: context.pageContract.actionKind,
        theme: context.currentTheme,
        themePreference: context.localConfig?.['wiki.theme'],
        localConfig: context.localConfig,
        config,
        hasToc: Array.isArray(context.pageData?.headings) && context.pageData.headings.length > 0
      });
    },
    rootClassList() { return { 'tt-vector-2022': true }; }
  },
  watch: { documentEnvironment: { deep: true, handler() { this.syncEnvironment(); } } },
  mounted() { this.syncEnvironment(); },
  beforeDestroy() { this.teardownEnvironment(); },
  beforeUnmount() { this.teardownEnvironment(); },
  methods: {
    syncEnvironment() {
      this.teardownEnvironment();
      this.cleanup = applyVector2022DocumentEnvironment(this.documentEnvironment);
    },
    teardownEnvironment() { this.cleanup?.(); this.cleanup = null; }
  }
};
</script>
