---
id: "crear-youtube-player-2026-09-29"
status: "backlog"
priority: "medium"
assignee: null
epic: null
dueDate: null
created: "2026-09-28T23:27:40.046Z"
modified: "2026-09-29T17:06:02.102Z"
completedAt: null
labels: []
order: "a2"
---
# Crear youtube player

Usando codeBlocks y lo que necesites, (Puedes crear nuevos componentes genericos y reusables si lo necesitas), crea un reproductor de video de youtube. que pueda buscar, reproducir, etc. Usando esta api:\
Search: <https://api.piped.private.coffee/search?q=mrbeast&filter=videos>\
Video: <https://api.piped.private.coffee/streams/dQw4w9WgXcQ>\
\
\
Ejemplo de codigo funcional en web standard:\
const data = await fetch( '<https://api.piped.private.coffee/streams/dQw4w9WgXcQ>' ).then(r =&gt; r.json());

const stream = data.videoStreams.find( s =&gt; s.mimeType === 'video/mp4' && s.videoOnly === false && s.quality !== 'LBRY' );

console.log(stream);

const video = document.createElement('video'); video.controls = true; video.src = stream.url; [video.style](http://video.style).width = '700px'; document.body.appendChild(video); [video.play](http://video.play)();