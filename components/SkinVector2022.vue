<template>
  <SkinOrigin
    :data="skinData"
    :intercept-events="['submit']"
    @submit="submitSearch"
    @click="onSkinClick($event)"
  >
    <template #html-site-notice>
      <div v-if="siteNoticeHtml" id="siteNotice">
        <div id="localNotice" data-nosnippet><div class="sitenotice" v-html="siteNoticeHtml"></div></div>
      </div>
    </template>

    <template #html-title-heading>
      <RawHtmlFragment v-if="titleHeadingHtml" :html="titleHeadingHtml" />
      <h1 v-else id="firstHeading" class="firstHeading mw-first-heading">
        <span class="mw-page-title-main">{{ pageTitle }}</span>
      </h1>
    </template>

    <template #html-user-message>
      <div v-if="hasUnreadUserDiscussion" class="usermessage">
        <nuxt-link :to="userDiscussionTarget">{{ userDiscussionLabel }}</nuxt-link>
        <button type="button" class="tt-usermessage-close" :aria-label="dismissLabel" @click="dismissUserDiscussion">×</button>
      </div>
      <alert v-if="isShowACLMessage && editAclMessageHtml" error closable @close="isShowACLMessage = false">
        <span v-html="editAclMessageHtml"></span>
        <span v-if="requestable"><br><nuxt-link :to="editRequestTarget">{{ editRequestLabel }}</nuxt-link></span>
      </alert>
    </template>

    <template #html-body-content>
      <div
        id="mw-content-text"
        class="mw-body-content"
        key="mw-content-text"
        data-tt-host-content="1"
        :data-tt-host-content-name="adapterContext.pageContract.hostContentName || null"
      >
        <slot />
      </div>
    </template>

    <template #html-after-content><slot name="after-content" /></template>
  </SkinOrigin>
</template>

<script>
import Common from '~/mixins/common';
import Alert from '~/components/alert';
import { createApp } from 'vue';

import SkinOrigin from './skin.vue';
import Vector2022SettingModal from './Vector2022SettingModal.vue';
import RawHtmlFragment from '../lib/RawHtmlFragment.js';
import MediaWikiTypeaheadSearchOrigin from '../lib/generated/mediawiki.skinning.typeaheadSearch/App.vue';
import { isVector2022AccountLoggedIn, makeVector2022TheTreeContext } from '../lib/vector2022TheTreeAdapter.js';
import { makeVector2022HostState } from '../lib/vector2022HostState.js';
import { makeVector2022SkinData } from '../lib/vector2022SkinData.js';
import { hasVector2022Message, makeVector2022MessageLocalizer } from '../lib/vector2022Messages.js';
import { isSettingsToggleTarget } from '../lib/adapters/thetree-settings.js';
import {
  createTheTreeSearchSuggestRuntime,
  createVector2022RuntimeController
} from '../lib/runtime/createVector2022RuntimeController.js';

export default {
  name: 'SkinVector2022',
  mixins: [Common],
  components: { Alert, RawHtmlFragment, SkinOrigin },
  data() {
    return { isShowACLMessage: true, runtimeController: null };
  },
  computed: {
    adapterContext() {
      return makeVector2022TheTreeContext({
        storeState: this.$store.state,
        route: this.$route,
        linkBuilders: {
          documentAction: (document, action, query) => this.doc_action_link(document, action, query),
          userDocument: (name, type) => this.user_doc(name, type),
          contribution: (uuid) => this.contribution_link(uuid),
          href: (target) => this.resolveHref(target)
        }
      });
    },
    skinData() { return makeVector2022SkinData(this.adapterContext); },
    skinAdapter() { return makeVector2022HostState(this.adapterContext); },
    message() { return makeVector2022MessageLocalizer(this.adapterContext.config); },
    pageTitle() { return this.skinData['page-title'] || ''; },
    titleHeadingHtml() { return this.skinData['html-title-heading'] || ''; },
    siteNoticeHtml() { return this.skinAdapter.siteNoticeHtml; },
    hasUnreadUserDiscussion() { return this.skinAdapter.hasUnreadUserDiscussion; },
    userDiscussionTarget() { return this.skinAdapter.userDiscussionTarget; },
    editAclMessageHtml() { return this.skinAdapter.editAclMessageHtml; },
    requestable() { return this.skinAdapter.requestable; },
    editRequestTarget() { return this.skinAdapter.editRequestTarget; },
    userDiscussionLabel() { return this.message('thetree-user-discussion', '사용자 토론'); },
    dismissLabel() { return this.message('thetree-dismiss-user-discussion', '사용자 토론 알림 닫기'); },
    editRequestLabel() { return this.message('thetree-create-edit-request', '편집 요청 만들기'); }
  },
  watch: {
    $route() { this.isShowACLMessage = true; this.resetRuntime(); },
    skinData() { this.resetRuntime(); }
  },
  mounted() { this.initRuntime(); },
  beforeDestroy() { this.destroyRuntime(); },
  beforeUnmount() { this.destroyRuntime(); },
  methods: {
    resolveHref(target) {
      if (typeof target === 'string') return target;
      try { return this.$router.resolve(target).href; } catch (error) { return '#'; }
    },
    onSkinClick(event) {
      const settingsToggle = isSettingsToggleTarget(event?.target);
      if (settingsToggle) {
        event.preventDefault();
        event.stopPropagation();
        this.$vfm.show({ component: Vector2022SettingModal });
        return;
      }
      if (!event?.defaultPrevented) this.onDynamicContentClick(event);
    },
    dismissUserDiscussion() {
      const value = this.skinAdapter.userDiscussionKey;
      if (!value) return;
      this.$store.commit?.('localConfigSetValue', { key: 'wiki.hide_user_document_discuss', value });
    },
    submitSearch(event) {
      event.preventDefault();
      const input = event.target?.elements?.search;
      const query = String(input?.value || '').trim();
      if (!query) return input?.focus?.();
      this.$router.push({ path: '/Search', query: { q: query } });
    },
    createSearchRuntime() {
      return createTheTreeSearchSuggestRuntime({
        requestSuggestions: (query, signal) => this.internalRequest(`/Complete?q=${encodeURIComponent(query)}`, { signal, noProgress: true }),
        documentUrl: (title) => this.resolveHref(this.doc_action_link(title, 'w')),
        searchUrl: (query) => this.resolveHref({ path: '/Search', query: { q: query } }),
        mountSearchApp: (target, props) => {
          const app = createApp(MediaWikiTypeaheadSearchOrigin, props);
          app.mount(target);
          return () => app.unmount();
        }
      });
    },
    ensureRuntime() {
      if (!this.runtimeController) {
        this.runtimeController = createVector2022RuntimeController({
          createSearchRuntime: () => this.createSearchRuntime(),
          onPinChange: (feature, enabled) => this.$store.commit?.('localConfigSetValue', {
            key: `skin.vector-2022.${feature.replaceAll('-', '_')}`,
            value: enabled ? 1 : 0
          }),
          onClientPreferenceChange: (feature, value) => this.saveClientPreference(feature, value),
          message: this.message,
          messageExists: (key) => hasVector2022Message(this.adapterContext.config, key),
          isNamed: isVector2022AccountLoggedIn(this.adapterContext),
          pageName: this.adapterContext.pageContract?.documentTitle || this.pageTitle,
          title: this.pageTitle,
          namespace: this.adapterContext.pageContract?.namespaceId,
          action: this.adapterContext.pageContract?.actionKind,
          schedule: (callback) => this.$nextTick(callback)
        });
      }
      return this.runtimeController;
    },
    initRuntime() { this.ensureRuntime().init(); },
    resetRuntime() {
      this.destroyRuntime();
      this.$nextTick(() => this.initRuntime());
    },
    saveClientPreference(feature, value) {
      const keyByFeature = {
        'vector-feature-custom-font-size': 'skin.vector-2022.font_size',
        'vector-feature-limited-width': 'skin.vector-2022.limited_width',
        'skin-theme': 'wiki.theme'
      };
      const key = keyByFeature[feature];
      if (!key) return;
      const normalized = feature === 'skin-theme'
        ? ({ os: 'auto', day: 'light', night: 'dark' }[value] || 'auto')
        : value;
      this.$store.commit?.('localConfigSetValue', { key, value: normalized });
      if (feature === 'skin-theme') {
        this.$store.state.currentTheme = normalized === 'auto'
          ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
          : normalized;
      }
    },
    destroyRuntime() { this.runtimeController?.destroy(); this.runtimeController = null; }
  }
};
</script>
