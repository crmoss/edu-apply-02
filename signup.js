'use strict';
// 화면 체험 전용: 인증·회원 저장·통신 기능은 사용하지 않는다.
(() => {
  const find = id => document.getElementById(id);
  const dialog = find('signupDialog');
  const form = find('signupForm');
  const nameInput = find('signupName');
  const phoneInput = find('signupPhone');
  const error = find('signupError');
  const result = find('signupResult');

  function clearPreview() {
    nameInput.value = '';
    phoneInput.value = '';
    find('signupPreviewName').textContent = '';
    find('signupPreviewPhone').textContent = '';
    error.textContent = '';
    error.hidden = true;
    form.hidden = false;
    result.hidden = true;
  }

  function showError(text, input) {
    error.textContent = text;
    error.hidden = false;
    input.focus();
  }

  find('openSignup').addEventListener('click', () => {
    clearPreview();
    dialog.showModal();
    nameInput.focus();
  });
  find('closeSignup').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', clearPreview);
  find('retrySignup').addEventListener('click', () => {
    clearPreview();
    nameInput.focus();
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    const name = nameInput.value.trim();
    const phoneText = phoneInput.value.trim();
    const phone = phoneText.replace(/[\s-]/g, '');
    if (!name || name.length > 30) {
      showError('이름을 1~30자로 입력해 주세요.', nameInput);
      return;
    }
    if (!/^[\d\s-]+$/.test(phoneText) || !/^010\d{8}$/.test(phone)) {
      showError('010으로 시작하는 휴대폰 번호 11자리를 입력해 주세요.', phoneInput);
      return;
    }
    error.textContent = '';
    error.hidden = true;
    find('signupPreviewName').textContent = name;
    find('signupPreviewPhone').textContent = `010-****-${phone.slice(-4)}`;
    // 결과 화면에서는 입력 원문을 폼에 남겨 두지 않는다.
    nameInput.value = '';
    phoneInput.value = '';
    form.hidden = true;
    result.hidden = false;
    find('retrySignup').focus();
  });
})();
