# Musicala - Formulario de inscripción web

Este ZIP incluye una versión web del formulario de inscripción de Musicala, conectable a Google Sheets y Google Drive mediante Google Apps Script.

## Archivos incluidos
- index.html
- styles.css
- app.js
- Code.gs

## Qué hace
- Replica la lógica principal del formulario original
- Muestra preguntas condicionales por curso
- Guarda respuestas en Google Sheets
- Guarda foto del estudiante en Google Drive
- No permite dos correos iguales
- Tiene validaciones de frontend y backend

## Antes de usar
1. En Code.gs completar:
   - SHEET_NAME
   - DRIVE_FOLDER_ID
2. Publicar Apps Script como Web App
3. Copiar la URL del Web App y pegarla en app.js
4. Subir index.html, styles.css y app.js a su frontend

## Recomendaciones de seguridad
- Usar una carpeta exclusiva de Drive para las fotos
- No aceptar archivos distintos a imagen
- Mantener límite de 3 MB
- No compartir la carpeta de Drive públicamente

## Nota
La hoja ya quedó apuntando al archivo con ID:
1MsWABlj_LdhWKzVq_u-1M6S5zEJ2yQ72oiusvzzQZAI
