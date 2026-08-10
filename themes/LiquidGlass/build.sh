#!/bin/bash

echo "Building LiquidGlass SCSS..."

# Build Cinnamon Theme
npx sass src/cinnamon/cinnamon.scss cinnamon/cinnamon.css --no-source-map

# Build GTK Themes
npx sass src/gtk-3.0/gtk.scss gtk-3.0/gtk.css --no-source-map
npx sass src/gtk-4.0/gtk.scss gtk-4.0/gtk.css --no-source-map

echo "Done!"
