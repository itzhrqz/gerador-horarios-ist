![](./src/assets/readme/banner.png)

<p align="center">
  <a href="https://github.com/itzhrqz/gerador-horarios-ist/releases/" target="_blank">
    <img alt="GitHub release" src="https://img.shields.io/github/v/release/itzhrqz/gerador-horarios-ist?include_prereleases&style=flat-square">
  </a>

  <a href="https://github.com/itzhrqz/gerador-horarios-ist/commits/master" target="_blank">
    <img src="https://img.shields.io/github/last-commit/itzhrqz/gerador-horarios-ist?style=flat-square" alt="GitHub last commit">
  </a>

  </br>

  <a href="https://github.com/itzhrqz/gerador-horarios-ist/issues" target="_blank">
    <img src="https://img.shields.io/github/issues/itzhrqz/gerador-horarios-ist?style=flat-square&color=red" alt="GitHub issues">
  </a>

  <a href="https://github.com/itzhrqz/gerador-horarios-ist/pulls" target="_blank">
    <img src="https://img.shields.io/github/issues-pr/itzhrqz/gerador-horarios-ist?style=flat-square&color=blue" alt="GitHub pull requests">
  </a>

  <a href="https://github.com/itzhrqz/gerador-horarios-ist#contribute" target="_blank">
    <img alt="Contributors" src="https://img.shields.io/badge/dynamic/json?color=orange&style=flat-square&label=all%20contributors&query=%24.contributors.length&url=https://raw.githubusercontent.com/itzhrqz/gerador-horarios-ist/master/.all-contributorsrc">
  </a>

  <a href="https://github.com/itzhrqz/gerador-horarios-ist/blob/master/LICENSE" target="_blank">
    <img alt="LICENSE" src="https://img.shields.io/github/license/itzhrqz/gerador-horarios-ist?style=flat-square&color=yellow">
  </a>
</p>

<h4 align="center">
  <a href="https://github.com/itzhrqz/gerador-horarios-ist">Gerador de Horários | IST</a>
</h4>

<hr>

# Gerador de Horários | IST

A schedule generator for [IST](https://tecnico.ulisboa.pt/en/) students to plan their schedule for the semester.

This application uses the [FenixEdu API](https://fenixedu.org/dev/api/) to get information about academic terms, degrees, courses and their timetables.

<p align="center">
  <img alt="logo" src="./src/assets/readme/logo.png">
</p>

<p align="center">
  <img alt="Schedule generator presentation" src="https://raw.githubusercontent.com/itzhrqz/gerador-horarios-ist/master/src/assets/readme/presentation.gif">
</p>

# About this version

This repository started as [Joana Sesinando's original project](https://github.com/joanasesinando/gerador-horarios-ist). IST changed from period to semester-based schedules, which greatly increased the number of possible schedule combinations for some courses.

Because the original author is no longer available to maintain the project, I decided to take over the repository and make an emergency update. This is not intended to be a finished or polished version. The main goal is to keep the generator usable with the new semester structure.

The biggest issue was memory usage. For example, a second-year LEEC student can have 4 laboratories in addition to theoretical classes and problem classes. Generating all the possible combinations can easily result in more than one million schedules, which quickly causes the application to run out of memory.

This update fixes the out-of-memory problem by loading schedules in batches instead of keeping every generated schedule in memory at once.

# Features

### Sort schedules

You can sort generated schedules to favor a specific characteristic.
There are 3 sorting options:

- **Most compact** - favors schedules with fewer gaps and classes that are closer together;
- **Most balanced** - favors schedules that are more evenly distributed throughout the week;
- **More free days** - favors schedules with more free days.

<p align="center">
  <img alt="Sort schedules" src="https://raw.githubusercontent.com/itzhrqz/gerador-horarios-ist/master/src/assets/readme/feature1.gif">
</p>

### Pin classes

Once you find a class you like, you can pin it. Only schedules containing the pinned classes will then be shown.

<p align="center">
  <img alt="Pin classes" src="https://raw.githubusercontent.com/itzhrqz/gerador-horarios-ist/master/src/assets/readme/feature2.gif">
</p>

### Exclude classes and timeframes

You can exclude specific classes or time periods when you are unavailable.

<p align="center">
  <img alt="Exclude class" src="https://raw.githubusercontent.com/itzhrqz/gerador-horarios-ist/master/src/assets/readme/feature3.gif">
</p>

<p align="center">
  <img alt="Exclude timeframe" src="https://raw.githubusercontent.com/itzhrqz/gerador-horarios-ist/master/src/assets/readme/feature4.gif">
</p>

### Change colors

You can customize the appearance of your schedule by changing the colors of its classes.

<p align="center">
  <img alt="Change colors" src="https://raw.githubusercontent.com/itzhrqz/gerador-horarios-ist/master/src/assets/readme/feature6.gif">
</p>

### Save for later

You can add schedules to a queue and print the saved schedules to a PDF file when you are finished.

<p align="center">
  <img alt="Save for later" src="https://raw.githubusercontent.com/itzhrqz/gerador-horarios-ist/master/src/assets/readme/feature5.gif">
</p>

### Schedule generation in batches

The generator no longer tries to keep every possible schedule in memory at the same time.

You can enter the maximum number of schedules that should be loaded into memory. The application then generates and displays schedules in batches of that size.

When you reach the end of the current batch, you can generate the next batch. The previous batch is removed from memory and replaced with the next set of schedule combinations. This makes it possible to work through very large numbers of possible schedules without running out of memory.

### Classes from different shifts

This version also includes an optional feature originally contributed by [ricardo55ribeiro](https://github.com/ricardo55ribeiro) in an earlier pull request.

It allows you to combine classes from different shifts within the same class type (TP, PB, etc.). For example, you can choose the first theoretical class from Shift 2 and the second theoretical class from Shift 1.

This can be useful when you want to build a schedule based on the classes you actually attend rather than exactly matching the schedule shown in Fenix.

A global toggle in the top-right corner enables or disables this feature:

- **Disabled:** the generator behaves like the original version and keeps the same shift for the class type;
- **Enabled:** classes from different shifts can be combined within the same class type.

Students are responsible for checking which classes are mandatory and where this option is valid. It may be useful for some class types, but it is not necessarily valid for every course structure. For example, combining different shifts may make sense for some theoretical-practical classes, but not for a laboratory where the sessions are part of a fixed structure.

When there is only one weekly session of a given class type, the option is not available because there is no meaningful shift to combine.

# Development

This project uses [Angular CLI](https://cli.angular.io/) version 13.2.2.

## Run

Clone this repository, enter the project folder, install the dependencies and start the development server:

```sh
npm install
npx ng serve --host 0.0.0.0
```

The application will be available at `http://localhost:4200/`.

The development server automatically reloads when source files are changed.

## Code scaffolding

To generate a new component:

```sh
npx ng generate component component-name
```

You can also generate other Angular elements such as directives, pipes, services, classes, guards, interfaces, enums and modules.

## Test

To run the unit tests with [Karma](https://karma-runner.github.io/):

```sh
npx ng test
```

## Further help

For more information about the Angular CLI, run:

```sh
npx ng help
```

You can also read the [Angular CLI documentation](https://angular.dev/cli).

# Contribute

Please check the [**Contributing Guidelines**](https://github.com/itzhrqz/gerador-horarios-ist/blob/master/CONTRIBUTING.md) before contributing.

The project currently has one active contributor, [itzhrqz](https://github.com/itzhrqz) and the main repository hasn't been updated since September 2024. As there is still a meaningful amount of bugs, deprecated tools and some unfinished QoL changes, due to the importance this software has in the IST students community and the role it has during enrollment periods, new collaborations are not only appreciated but highly encouraged.  

Thanks to everyone who has contributed to this project:

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tr>
    <td align="center"><a href="https://github.com/joanasesinando"><img src="https://github.com/joanasesinando.png?size=100" width="100px;" alt="Joana Sesinando"/><br /><sub><b>Joana Sesinando</b></sub></a><br /><a href="https://github.com/joanasesinando/gerador-horarios-ist/commits?author=joanasesinando" title="Code">💻</a> <a href="#design-joanasesinando" title="Design">🎨</a> <a href="#translation-joanasesinando" title="Translation">🌍</a> <a href="https://github.com/joanasesinando/gerador-horarios-ist/commits?author=joanasesinando" title="Tests">⚠️</a></td>
    <td align="center"><a href="https://github.com/bernardocmarques"><img src="https://github.com/bernardocmarques.png?size=100" width="100px;" alt="Bernardo Marques"/><br /><sub><b>Bernardo Marques</b></sub></a><br /><a href="#infra-bernardocmarques" title="Infrastructure (Hosting, Build-Tools, etc)">🚇</a> <a href="#ideas-bernardocmarques" title="Ideas, Planning, & Feedback">🤔</a> <a href="https://github.com/joanasesinando/gerador-horarios-ist/commits?author=bernardocmarques" title="Code">💻</a></td>
    <td align="center"><a href="https://github.com/TigoDelgado"><img src="https://github.com/TigoDelgado.png?size=100" width="100px;" alt="Tigo"/><br /><sub><b>Tigo</b></sub></a><br /><a href="#ideas-TigoDelgado" title="Ideas, Planning, & Feedback">🤔</a></td>
    <td align="center"><a href="https://github.com/ricardo55ribeiro"><img src="https://github.com/ricardo55ribeiro.png?size=100" width="100px;" alt="ricardo55ribeiro"/><br /><sub><b>ricardo55ribeiro</b></sub></a><br /><a href="https://github.com/itzhrqz/gerador-horarios-ist/commits?author=ricardo55ribeiro" title="Code">💻</a> <a href="#ideas-ricardo55ribeiro" title="Ideas, Planning, & Feedback">🤔</a></td>
    <td align="center"><a href="https://github.com/itzhrqz"><img src="https://github.com/itzhrqz.png?size=100" width="100px;" alt="itzhrqz"/><br /><sub><b>itzhrqz</b></sub></a><br /><a href="https://github.com/itzhrqz/gerador-horarios-ist/commits?author=itzhrqz" title="Code">💻</a> <a href="#ideas-itzhrqz" title="Ideas, Planning, & Feedback">🤔</a> <a href="#infra-itzhrqz" title="Infrastructure (Hosting, Build-Tools, etc)">🚇</a></td>
  </tr>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->
<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors](https://allcontributors.org/docs/en/emoji-key) specification. Contributions of any kind are welcome.

# License

[MIT](https://github.com/itzhrqz/gerador-horarios-ist/blob/master/LICENSE)
