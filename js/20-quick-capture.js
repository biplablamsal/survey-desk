/* Quick Capture: phone-first field screen — live camera burst, dictated captions, continue-an-inspection
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

const CAP = { stream: null, facing: 'environment', shots: [], rec: null };

// Field work is anything not past Document Collection; later stages are desk work.
const FIELD_LAST = 'Document Collection';

function camStop() {
  if (CAP.stream) CAP.stream.getTracks().forEach((t) => t.stop());
  CAP.stream = null;
}

/* Unsaved shots live in memory; sessionStorage keeps them across an accidental reload
   only while they stay small, because a burst of full-size frames blows the ~5 MB quota. */
function capPersist() {
  try {
    const j = JSON.stringify(CAP.shots);
    if (j.length < 2e6) sessionStorage.setItem('sp.cap.' + cur, j);
    else sessionStorage.removeItem('sp.cap.' + cur);
    return j.length < 2e6;
  } catch {
    return false;
  }
}

function capRestore() {
  CAP.shots = [];
  try {
    /* Only this case's burst: the key is per case, and a shot that knows it belongs elsewhere is
       dropped rather than shown. Shots saved before the stamp was introduced have no cid. */
    CAP.shots = (JSON.parse(sessionStorage.getItem('sp.cap.' + cur) || '[]') || []).filter(
      (s) => !s.cid || s.cid === cur
    );
  } catch {
    CAP.shots = [];
  }
}

/* The live-camera block, built once and placed by photosUI() at the top of Photos & Annexes:
   capture, upload and the saved list are one job on one page, on the phone as well as at the desk.
   Returns the element so the caller decides the order. */
function camUI() {
  const video = h('video', { playsinline: 'playsinline' });
  video.muted = true;
  const cv = document.createElement('canvas'),
    cat = h('select', {}, ...PC.map(([c, t]) => h('option', { value: c }, t))),
    cap = h('input', {
      placeholder: 'Caption for the next shots – type or dictate',
      maxlength: '120',
    }),
    status = h('p', { class: 'mu' }),
    strip = h('div', { class: 'burst' }),
    count = h('b', {}),
    fi = h('input', { type: 'file', accept: 'image/*', capture: 'environment' }),
    canCam =
      !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;

  cat.value = PC.some(([c]) => c === 'iv') ? 'iv' : (PC[0] || ['', ''])[0];

  const drawBurst = () => {
    strip.replaceChildren(
      ...CAP.shots.map((s, i) =>
        h(
          'div',
          { class: 'shot' },
          h('img', { src: s.img, alt: '' }),
          h(
            'button',
            {
              class: 'b x',
              type: 'button',
              title: 'Discard this shot',
              onclick: () => {
                CAP.shots.splice(i, 1);
                capPersist();
                drawBurst();
              },
            },
            'Discard'
          )
        )
      )
    );
    count.textContent =
      CAP.shots.length +
      ' shot' +
      (CAP.shots.length === 1 ? '' : 's') +
      ' not saved to the case yet';
  };

  /* The review dialog can discard a shot from the live burst; this is how the strip hears about
     it without waiting for the dialog to close. */
  CAP.sync = () => {
    capPersist();
    drawBurst();
  };

  const pushShot = (img, name) => {
    CAP.shots.push({
      img,
      name,
      /* Stamped with the case it was taken for, so a shot cannot be filed under whichever case
         happens to be open when it is saved. */
      cid: cur,
      category: cat.value,
      caption: cap.value.trim(),
    });
    drawBurst();
    if (!capPersist())
      status.textContent =
        'Burst is large – shots are held in memory only, so save them before closing this tab.';
  };

  const startCam = async () => {
    if (!canCam) {
      status.textContent =
        'The live camera needs https or localhost. Use Take photo below – it opens the phone camera instead.';
      return;
    }
    try {
      camStop();
      CAP.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: CAP.facing, width: { ideal: 1920 } },
        audio: false,
      });
      video.srcObject = CAP.stream;
      await video.play();
      status.textContent = '';
    } catch (e) {
      /* A stream that was granted but never played has to be handed back, or the camera stays lit
         with nothing on screen to close it. */
      camStop();
      video.srcObject = null;
      const why =
        e && e.name === 'NotAllowedError'
          ? 'Camera permission was declined – allow it in the browser, or use Take photo.'
          : 'No camera available here – use Take photo to open the phone camera instead.';
      status.textContent = why;
    }
    paintCam();
  };

  const stopCam = () => {
    camStop();
    video.srcObject = null;
    paintCam();
  };

  const snap = () => {
    if (!CAP.stream) {
      status.textContent = 'The camera is closed – press Open camera first.';
      return;
    }
    if (!video.videoWidth) {
      status.textContent = 'Camera is still starting – one more moment.';
      return;
    }
    const k = Math.min(1, 1400 / Math.max(video.videoWidth, video.videoHeight));
    cv.width = Math.round(video.videoWidth * k);
    cv.height = Math.round(video.videoHeight * k);
    cv.getContext('2d').drawImage(video, 0, 0, cv.width, cv.height);
    pushShot(cv.toDataURL('image/jpeg', 0.78), 'Shot ' + (CAP.shots.length + 1));
  };

  const shut = h(
    'button',
    { class: 'b p shut', type: 'button', onclick: snap },
    h('span', { class: 'ring' }),
    'Shutter'
  );
  const flip = h(
    'button',
    {
      class: 'b',
      type: 'button',
      onclick: () => {
        CAP.facing = CAP.facing === 'environment' ? 'user' : 'environment';
        /* Flipping while the preview is closed only changes which camera the next Open uses; it does
           not switch the camera on. */
        if (CAP.stream) startCam();
        else status.textContent = 'Rear/front camera chosen – press Open camera to use it.';
      },
    },
    '⟳ Flip'
  );
  const saveAll = h(
    'button',
    {
      class: 'b p',
      type: 'button',
      onclick: async () => {
        if (!CAP.shots.length) {
          status.textContent = 'Nothing to save yet – take a shot first.';
          return;
        }
        await reviewBatch(CAP.shots, (saved) => {
          CAP.shots = [];
          capPersist();
          drawBurst();
          if (PHDRAW) PHDRAW();
          status.textContent = `${saved} photo${saved === 1 ? '' : 's'} saved to this case and ready for the report.`;
          paint();
        });
      },
    },
    'Review & save'
  );

  fi.onchange = async () => {
    let n = 0;
    for (const f of fi.files) {
      if (!f.type.startsWith('image/') || f.size > 20e6) continue;
      try {
        pushShot(await shrink(f, cat.value === 'est' ? 2000 : 1400), f.name);
        n++;
      } catch {}
    }
    fi.value = '';
    status.textContent = n
      ? `${n} photo${n === 1 ? '' : 's'} added from the camera app.`
      : 'No supported photo was added.';
  };

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = h(
    'button',
    {
      class: 'b mic',
      type: 'button',
      onclick: () => {
        if (!SR) return;
        if (CAP.rec) {
          CAP.rec.stop();
          return;
        }
        const r = new SR();
        r.lang = 'en';
        r.continuous = true;
        r.interimResults = true;
        const base = cap.value.trim();
        r.onresult = (e) => {
          let txt = '';
          for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
          cap.value = (base ? base + ' ' : '') + txt.trim();
        };
        r.onend = () => {
          CAP.rec = null;
          mic.classList.remove('rec');
          mic.textContent = '🎤 Dictate';
        };
        r.onerror = (e) => {
          status.textContent =
            e && e.error === 'not-allowed'
              ? 'Microphone permission was declined – dictate from the phone keyboard instead.'
              : 'Dictation stopped.';
        };
        CAP.rec = r;
        mic.classList.add('rec');
        mic.textContent = '■ Stop';
        r.start();
      },
    },
    '🎤 Dictate'
  );
  if (!SR) {
    mic.disabled = true;
    mic.title = 'This browser has no voice dictation – type the caption instead';
  }

  const camBtn = h(
    'button',
    {
      class: 'b',
      type: 'button',
      'aria-pressed': 'false',
      onclick: () => (CAP.stream ? stopCam() : startCam()),
    },
    '📷 Open camera'
  );

  /* The viewfinder is built closed. Opening Photos & Annexes used to call getUserMedia by itself,
     which put the phone's camera to work — and the browser's permission prompt up — for a surveyor
     who only came to look at the case. Both affordances below start it deliberately, and both are
     the same ordinary button as the ones under the frame, not a full-screen target. */
  const idle = canCam
    ? h(
        'button',
        { class: 'b vf-idle', type: 'button', onclick: () => startCam() },
        covCamIcon(18),
        'Open camera'
      )
    : h(
        'div',
        { class: 'b vf-idle off' },
        covCamIcon(18),
        'Live camera unavailable on this address'
      );

  const paintCam = () => {
    const on = !!CAP.stream;
    idle.hidden = on;
    camBtn.textContent = on ? '■ Close camera' : '📷 Open camera';
    camBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  };

  const camCard = h(
    'section',
    { class: 'card cam capcard' },
    h('div', { class: 'bar' }, h('h3', { style: 'margin:0' }, 'Camera'), count),
    h('div', { class: 'vf' }, video, idle),
    h(
      'div',
      { class: 'grid' },
      h('div', { class: 'fld' }, h('label', {}, 'Annex category'), cat),
      h('div', { class: 'fld' }, h('label', {}, 'Caption'), cap, mic)
    ),
    h(
      'div',
      { class: 'bar cambar' },
      shut,
      saveAll,
      h(
        'button',
        { class: 'b', type: 'button', onclick: () => fi.click() },
        'Take photo (phone camera)'
      ),
      flip,
      camBtn
    ),
    h('div', { class: 'vhide' }, fi),
    strip,
    status
  );

  capRestore();
  drawBurst();
  /* A page re-render rebuilds this card while a running stream from the previous build is still
     alive, so hand that stream to the new <video>; otherwise the viewfinder looks open but shows
     nothing, and the only control that can fix it is buried under a hidden overlay. */
  if (CAP.stream) {
    video.srcObject = CAP.stream;
    video.play().catch(() => {});
  }
  paintCam();
  if (!canCam)
    status.textContent =
      'Live camera needs https or localhost. Take photo opens the phone camera and adds the shot to the same list.';
  return camCard;
}

/* Which field work is still open, folded under the camera so a surveyor can move to the next case
   without leaving the page. */
function capSwitchUI() {
  const field = caseDirectoryRows()
    .filter((r) => act(r.c) && STG.indexOf(r.c.st) <= STG.indexOf(FIELD_LAST))
    .sort(
      (a, b) =>
        pri(a.c)[2] - pri(b.c)[2] || String(a.c.asg || '').localeCompare(String(b.c.asg || ''))
    );

  const listCard = h(
    'details',
    { class: 'card capfold' },
    h(
      'summary',
      {},
      'Assigned cases & unfinished inspections',
      h('span', { class: 'mu' }, ' (' + field.length + ')')
    ),
    field.length
      ? h(
          'div',
          { class: 'caplist' },
          ...field.slice(0, 12).map((r) => {
            const d = dl(r.c, 'p'),
              pr = pri(r.c);
            return h(
              'div',
              { class: 'caprow' + (r.c.id === cur ? ' on' : '') },
              h(
                'div',
                {},
                h('b', {}, r.id),
                h('div', { class: 'mu' }, `${r.who} · ${r.ref}`),
                h(
                  'div',
                  { class: 'mu' },
                  r.c.st,
                  ' · ',
                  d.txt,
                  pr[0] === 'Urgent' ? h('span', { class: 'pill er' }, ' urgent') : ''
                )
              ),
              h(
                'button',
                {
                  class: 'b',
                  type: 'button',
                  onclick: () => {
                    camStop();
                    openCase(r.c.id);
                    sec = 'photos';
                    render();
                  },
                },
                r.c.id === cur ? 'Photos here' : 'Switch & capture'
              )
            );
          })
        )
      : h(
          'p',
          { class: 'mu' },
          'No open field inspections – everything is past Document Collection.'
        ),
    h(
      'div',
      { class: 'bar' },
      h(
        'button',
        {
          class: 'b',
          type: 'button',
          onclick: () => {
            camStop();
            openNew();
          },
        },
        '+ New case'
      )
    )
  );

  return listCard;
}

window.addEventListener('pagehide', camStop);
