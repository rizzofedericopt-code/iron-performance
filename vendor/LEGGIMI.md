# Librerie di terze parti

`tf.min.js` — TensorFlow.js 4.22.0, bundle `tf.es2017.min.js`, licenza Apache 2.0.
Si usa il bundle ES2017 perché quello classico contiene un `Function("return this")`
che la Content-Security-Policy dell'app (giustamente) blocca.
