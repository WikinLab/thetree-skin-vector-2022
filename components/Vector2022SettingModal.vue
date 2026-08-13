<template>
  <Setting>
    <p class="tt-vector-2022-setting-note">Vector 2022의 화면 설정은 보이기 메뉴에서 변경할 수 있습니다.</p>
  </Setting>
</template>

<script>
import Setting from '~/components/setting';

export default {
  name: 'Vector2022SettingModal',
  components: { Setting }
};
</script>

<style scoped>
.tt-vector-2022-setting-note {
  color: #54595d;
  margin: 0;
}

.theseed-dark-mode .tt-vector-2022-setting-note {
  color: #a2a9b1;
}
</style>
