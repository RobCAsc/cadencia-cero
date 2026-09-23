# Cadencia Cero

Un juego de entrenamiento para bici estática. Una horda te persigue por una carretera de noche y pedaleas para que no te alcance; al terminar la salida, amanece. La entrada es tu **pulso**, leído por Bluetooth de una pulsera de muñeca: la prescripción del entrenamiento (la zona cardíaca de cada tramo) y el comportamiento de la horda son la misma cosa.

Juego en vivo: **https://robcasc.github.io/cadencia-cero/** (PWA para una tablet Android; se instala desde Chrome y funciona sin red).

Todo el arte y casi todo el sonido están hechos por código. Los únicos archivos binarios son ocho clips cortos de la horda y de la bici y una canción, en `assets/sfx`.

## Cómo funciona

- **El bucle**: `ventaja += (velocidad del ciclista − velocidad de la horda) · dt`. La velocidad del ciclista sale de la fracción de esfuerzo cardíaco (Karvonen, reserva de pulso) a través de una tabla de esfuerzo → km/h; la de la horda, de la zona que prescribe el tramo. Por debajo de la zona la horda gana; por encima del techo la ventaja se congela (pasarse tampoco paga). Que te alcancen cuesta un corazón y distancia, nunca termina la salida; la salud vuelve pedaleando en zona.
- **Los programas** (`src/sim/programs`): Primera salida, Recuperación, Fondo, Empujones, Oleadas, Pirámide, Umbral y Cuestas, más la salida que diseñes tú ("Mía") y "Solo diez minutos" para los días malos. El plan tiene fases (arranque, base, rotación, descarga) y recomienda la salida de cada día por lo que ya lleva la semana.
- **Diseñado para un pulso de muñeca**, que reacciona con 10 a 30 segundos de retraso: los esfuerzos duran un minuto o más, la horda avisa quince segundos antes y despierta durante todo el calentamiento, los bordes de zona toleran tres latidos, el techo baja en rampa al cambiar de tramo, y la vuelta a la calma no es una persecución.
- **Seguridad**: un cribado de cuatro preguntas antes de la primera salida (con un modo por sensación para quien no puede fiarse del pulso), un ritual de un minuto que mide el reposo del día, reglas de parada dentro de la salida (pulso por encima del máximo, pulso muy alto sostenido) y "Terminar" que enfría en vez de cortar. No es un dispositivo médico.
- **El hábito** es la meta y es lo único que se mide: la semana con dos puertas (tres salidas o 150 minutos de cardio), la racha por semanas, la Ruta (cada kilómetro suma un solo viaje con refugios como hitos), récords, marcas, temporadas de doce semanas, la revisión semanal, el fantasma de tu última o mejor salida, el día comprometido para la próxima. Sin monedas, sin niveles, sin desbloqueables.
- **La calibración** sale de una escalera de ocho minutos (dos anclas por test del habla) y de lo que dicen las salidas: un pico sostenido sube el máximo como mucho tres latidos por salida y solo si la salida fue limpia; "demasiado" baja la exigencia.

## Lo que se ve y se oye

- **El campamento**: un tablón de madera con papeles clavados, tinta, sellos y palotes de tiza; la semana, la Ruta dibujada a mano, la salud en tres relojes, la salida de hoy como cartel. Debajo suena *The Long Ride Home*.
- **La carretera**: parallax de noche con luna, farolas rotas, niebla que se espesa con la horda cerca, cuestas que inclinan el terreno, y el amanecer con rayos y pájaros al final. El ciclista es un superviviente (parka, pañuelo, casco con frontal, mochila con una palanca). Los refugios de la Ruta aparecen en el paisaje al cruzarlos, cada uno con su edificio.
- **Los encuentros**: dieciséis cosas que pasan de vez en cuando sin que nadie las prescriba (un ciervo cruzando, una lechuza, un gato en una tapia, otro superviviente que saluda con el timbre, un coche con los intermitentes, una señal pintada, un semáforo en ámbar, luciérnagas, una hoguera, cuervos, un tren en el horizonte, murciélagos, una lluvia de estrellas, un perro que corre contigo mientras aguantas la zona, caballos al galope que adelantas en Z3). Salen de una bolsa barajada, varios por salida y sin repetirse hasta que han salido todos, nunca en una oleada, y no tocan la simulación. El resumen los cuenta.
- **La HUD**: el pulso con un corazón que late, la ventaja con un zombi al lado, el tramo con su icono y el tiempo que queda, cinco corazones, y la tira de mapa (lo que hay detrás en metros y los próximos quince minutos). El botón "Mapa" abre el diario de la Ruta sobre papel.
- **El sonido**: viento, grillos, pájaros, el latido y el drone de la horda cuando se acerca, sintetizados en WebAudio; los gemidos, la manada corriendo, el alarido y el mordisco, el pedaleo y el cambio de marcha, de los clips.

## Desarrollo

Requiere Node 22.

```bash
npm install
```

```bash
npm run dev
```

Sirve en la red local; abre la URL que imprime Vite. Con `?dev=1` (o siempre en desarrollo) aparece el panel inferior con la cadencia y el pulso falsos, "Saltar segmento", "Sembrar historial" y "Conectar pulsera".

```bash
npm run dev:tablet
```

Igual, pero por HTTPS con certificado autofirmado: Web Bluetooth exige contexto seguro y desde la tablet `localhost` no vale. Acepta el aviso del certificado una vez.

```bash
npm test
```

Los tests corren en Node puro (la simulación no importa Phaser ni DOM). El más importante es `catalog.pulse.test.ts`: un ciclista modelo con el pulso retrasado que sigue la zona nunca es alcanzado en ningún programa del catálogo, y uno que se queda en Z2 durante las oleadas sí.

```bash
npm run build
```

Comprueba los tipos y genera `dist`. Cada push a `master` lo despliega GitHub Actions a GitHub Pages tras pasar los tests. El service worker precachea todo el build y espera a que la app se cierre para actualizarse: nunca recarga en mitad de una salida.

Para ver los dieciséis encuentros sin esperar salidas: `?preview=encuentros`.

## Estructura

- `src/sim`: la simulación, pura y testada (el bucle, las zonas, los programas, el plan, el progreso, las marcas, los encuentros, el ciclista modelo).
- `src/input`: las fuentes de entrada (pulsera BLE, sensor de cadencia BLE, fuentes falsas) tras una misma interfaz.
- `src/game`: Phaser: escenas, actores, la atmósfera, la HUD, el mapa, el papel, el sonido.
- `src/storage`: IndexedDB para las sesiones; localStorage para el perfil y el plan; exportar e importar como archivo.
- `src/dev`: el panel de desarrollo, el sembrado de historial y la vista previa de encuentros.
- `CLAUDE.md`: el contrato del proyecto, con las decisiones y su porqué. Léelo antes de proponer cambios de arquitectura.
