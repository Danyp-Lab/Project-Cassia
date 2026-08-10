# Project Cassia

![License](https://img.shields.io/badge/License-GPLv3-blue.svg)
![Platform](https://img.shields.io/badge/Platform-Cinnamon-orange.svg)
![Status](https://img.shields.io/badge/Status-Active_Development-brightgreen.svg)

Project Cassia is a suite of JavaScript applets, UI components, and productivity widgets designed for the Cinnamon Desktop Environment. The goal is to provide a cohesive ecosystem of extensions and themes that prioritize developer productivity and modern aesthetics.

## Included Applets

| Applet | Description |
|---|---|
| **Modern Hijri Shamsi Calendar** (`jalalicalendar@daniel-pm`) | A robust, multi-calendar engine supporting Gregorian, Jalali (Shamsi), and Hijri (Lunar) dates. Features memory-safe layout allocation, integration with Evolution Data Server (EDS), and a glassmorphism design with seasonal themes. |

## Included Themes

| Theme | Description |
|---|---|
| **LiquidGlass** | A modern glassmorphism Cinnamon theme designed for high-end aesthetics, featuring panel transparency, custom popover styling, and smooth hover state animations. |

## Repository Structure

The repository is structured to separate different types of Cinnamon components. Contributors can use these directories to add new features or enhancements.

```text
project-cassia/
├── applets/                        # Cinnamon panel applets (e.g., jalalicalendar@daniel-pm)
├── themes/                         # Cinnamon shell themes
├── desklets/                       # Desktop widgets
├── extensions/                     # Window manager enhancements
├── assets/                         # Repository images and assets
└── README.md                       # Project documentation
```

## Installation & Developer Setup

To install the currently available components, follow these steps to link them to your local Cinnamon share directory.

### 1. Clone the Repository
```bash
git clone https://github.com/DanialPahlavan/Project-Cassia.git
cd Project-Cassia
```

### 2. Install the Applet
Copy the applet to your local Cinnamon applets directory:
```bash
cp -r applets/jalalicalendar@daniel-pm ~/.local/share/cinnamon/applets/
```

*For local development and testing (Symlink approach):*
```bash
ln -s $(pwd)/applets/jalalicalendar@daniel-pm ~/.local/share/cinnamon/applets/
```

### 3. Install the Theme
Copy the theme to your local themes directory:
```bash
mkdir -p ~/.themes
cp -r themes/LiquidGlass ~/.themes/
```

*For local development and testing (Symlink approach):*
```bash
mkdir -p ~/.themes
ln -s $(pwd)/themes/LiquidGlass ~/.themes/
```

### 4. Enable the Components
**Applet:**
1. Right-click your Cinnamon panel and select **Applets**.
2. Navigate to the **Manage** tab.
3. Locate **Modern Hijri Shamsi Calendar** and click the `+` icon to add it to your panel.

**Theme:**
1. Open **System Settings** -> **Themes**.
2. Change the Desktop, Controls, or Borders theme to **LiquidGlass**.

## License

This project is open-sourced under the [GNU General Public License v3.0](LICENSE). Please review the `LICENSE` file for further details.