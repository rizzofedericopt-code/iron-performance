# Librerie di terze parti

`tf.min.js` — TensorFlow.js 4.22.0, bundle `tf.es2017.min.js`, licenza Apache 2.0.
Si usa il bundle ES2017 perché quello classico contiene un `Function("return this")`
che la Content-Security-Policy dell'app (giustamente) blocca.

`pdf.min.mjs` e `pdf.worker.min.mjs` — PDF.js 4.10.38 (pdfjs-dist, build `legacy` per i
telefoni meno recenti), licenza Apache 2.0 (`PDFJS-LICENSE.txt`). Serve solo a leggere il
testo del PDF dello scout, sul tuo dispositivo: il file non viene mandato da nessuna parte.
Si carica solo quando importi uno scout, con `isEvalSupported:false` perché la CSP non
permette eval.
