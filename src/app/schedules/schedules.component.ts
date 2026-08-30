import { AfterViewInit, ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';

import { LoggerService } from '../_util/logger.service';
import { AlertService } from '../_util/alert.service';
import { SchedulesGenerationService } from '../_services/schedules-generation/schedules-generation.service';
import { StateService } from '../_services/state/state.service';
import { PdfGenerationService } from '../_services/pdf-generation/pdf-generation.service';

import { Course } from '../_domain/Course/Course';
import { Schedule } from '../_domain/Schedule/Schedule';
import { TranslateService } from '@ngx-translate/core';

import { numberWithCommas } from '../_util/Number';

import { faQuestionCircle } from '@fortawesome/free-solid-svg-icons';
import { Lesson } from '../_domain/Lesson/Lesson';
import { getMinifiedWeekday, formatTime } from '../_util/Time';

declare let $: any;

@Component({
  selector: 'app-schedules',
  templateUrl: './schedules.component.html',
  styleUrls: ['./schedules.component.scss']
})
export class SchedulesComponent implements OnInit, AfterViewInit, OnDestroy {

  barValue = 0;
  canLoadMore = false;

  generatedSchedules: Schedule[] = [];
  selectedCourses: Course[] = [];
  eventColors: { [tag: number]: string };

  scheduleInViewID: number | null = null;
  schedulesPicked: Schedule[] = [];

  excludedShifts: string[] = [];
  excludedShiftsSubject: Subject<string[]> = new Subject<string[]>();

  excludedTimeframes: Lesson[] = [];
  excludedTimeframesSubject: Subject<Lesson[]> = new Subject<Lesson[]>();

  spinners = {
    loadingPage: true,
    sorting: false
  };

  mobileView = false;
  private initialGenerationTimer: ReturnType<typeof setTimeout> | null = null;
  keyDownSubject: Subject<string> = new Subject<string>();

  // FontAwesome icons
  faQuestionCircle = faQuestionCircle;

  constructor(
    private logger: LoggerService,
    private router: Router,
    private alertService: AlertService,
    public generationService: SchedulesGenerationService,
    private stateService: StateService,
    private pdfService: PdfGenerationService,
    private changeDetectorRef: ChangeDetectorRef,
    public translateService: TranslateService
  ) { }

  /* ==========================================================================
   * PROGRESS BAR
   * ======================================================================== */

  async updateBar(value: number): Promise<void> {
    if (value < -100 || value > 100) {
      return;
    }

    this.barValue += value;
    await this.setBar(this.barValue);
  }

  async setBar(value: number): Promise<void> {
    if (value < 0 || value > 100) {
      return;
    }

    /*
     * Always update the Angular-side value first.
     * This means the progress value is not lost even if the DOM element
     * does not exist yet.
     */
    this.barValue = value;

    /*
     * Angular may not have created #bar yet.
     * NEVER assume getElementById('bar') succeeded.
     */
    const bar = document.getElementById('bar') as HTMLElement | null;

    if (!bar) {
      /*
       * The DOM element does not exist yet.
       * Do not crash generation. Angular will render the element normally
       * and barValue already contains the correct value.
       */
      await new Promise(resolve => setTimeout(resolve, 0));

      /*
       * Try once more after giving Angular a chance to render.
       */
      const retryBar = document.getElementById('bar') as HTMLElement | null;

      if (!retryBar) {
        return;
      }

      retryBar.style.width = value + '%';
      retryBar.innerText = Math.ceil(value) + '%';
      retryBar.setAttribute('aria-valuenow', value.toString());
      return;
    }

    /*
     * Normal case.
     */
    bar.style.width = value + '%';
    bar.innerText = Math.ceil(value) + '%';
    bar.setAttribute('aria-valuenow', value.toString());

    /*
     * Give the browser time to render the progress bar.
     */
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  /* ==========================================================================
   * LOAD MORE
   * ======================================================================== */

  private updateCanLoadMore(): void {
    this.canLoadMore = this.generationService.hasMoreSchedules();
  }

async loadNextBatch(): Promise<void> {
    if (this.spinners.loadingPage) {
      return;
    }

    this.spinners.loadingPage = true;

    // Capture IDs BEFORE generating the next batch and replacing generatedSchedules
    const previousIds = this.generatedSchedules.map(s => s.id);
    const pickedIds = this.schedulesPicked.map(s => s.id);

    // 2. pwease memory be clear :sob:
    this.generationService.discardScheduleInfo(previousIds, pickedIds);
    this.generatedSchedules = [];
    this.scheduleInViewID = null;

    // Destroy the current batch's rendered view before allocating the next 500K batch.
    this.changeDetectorRef.detectChanges();
    await new Promise(resolve => setTimeout(resolve, 0));

    try {
      // 3. Now generate the next batch with a clean slate
      const nextSchedules = await this.generationService.generateNextBatch();

      this.generatedSchedules = nextSchedules;
      this.scheduleInViewID = nextSchedules[0]?.id ?? null;

    

      this.updateCanLoadMore();

      if (nextSchedules.length === 0) {
        this.translateService.currentLang === 'pt-PT' ?
          this.alertService.showAlert(
            'Sem mais horários',
            'Já não existem mais combinações possíveis.',
            'warning'
          ) :
          this.alertService.showAlert(
            'No more schedules',
            'There are no more possible combinations.',
            'warning'
          );
      }
    } catch (error) {
      this.logger.log('Error generating next batch', error);

      this.translateService.currentLang === 'pt-PT' ?
        this.alertService.showAlert(
          'Erro',
          'Ocorreu um erro ao gerar mais horários.',
          'warning'
        ) :
        this.alertService.showAlert(
          'Error',
          'An error occurred while generating more schedules.',
          'warning'
        );
    } finally {
      this.spinners.loadingPage = false;
    }
  }

  /* ==========================================================================
   * INITIALIZATION
   * ======================================================================== */

  ngOnInit(): void {
    this.onWindowResize();

    /*
     * Receive selected courses.
     */
    if (!this.stateService.hasStateSaved()) {
      this.router.navigate(['/']);
      return;
    }

    this.selectedCourses = this.stateService.selectedCourses;

    this.logger.log('courses to generate', this.selectedCourses);
  }

  ngAfterViewInit(): void {
    /*
     * Register the progress callbacks only after the component exists.
     */
    this.generationService.setBarFunctions(
      this.updateBar.bind(this),
      this.setBar.bind(this)
    );

    /*
     * Give Angular one more event-loop turn before starting generation.
     * This ensures the template has had an opportunity to create #bar.
     */
    this.initialGenerationTimer = setTimeout(async () => {
      try {
        const t0 = performance.now();

        this.generatedSchedules = await this.generationService.generateSchedules(
          this.selectedCourses
        );

        if (this.generatedSchedules[0]) {
          this.scheduleInViewID = this.generatedSchedules[0].id;
        }

        this.updateCanLoadMore();

        const t1 = performance.now();
        const generationTime = t1 - t0;

        this.logger.log('generated in (milliseconds)', generationTime);
        this.logger.log('generated schedules count', this.generatedSchedules.length);

        if (this.generatedSchedules.length === 0) {
          this.translateService.currentLang === 'pt-PT' ?
            this.alertService.showAlert(
              'Sem horários',
              'Não existe nenhum horário possível com estas cadeiras. Remove alguma e tenta de novo.',
              'warning'
            ) :
            this.alertService.showAlert(
              'No schedules',
              'There\'s no available schedules for the selected courses. Remove one and try again.',
              'warning'
            );

          this.goBack();
          return;
        }

        this.spinners.loadingPage = false;
        setTimeout(() => this.loadTooltips(), 100);

      } catch (error) {
        this.logger.log('Error generating schedules', error);
        this.spinners.loadingPage = false;
      }
    }, 0);
  }

  ngOnDestroy(): void {
    if (this.initialGenerationTimer !== null) {
      clearTimeout(this.initialGenerationTimer);
      this.initialGenerationTimer = null;
    }

    this.generationService.disposeGeneration();

    this.generatedSchedules = [];
    this.schedulesPicked = [];
    this.scheduleInViewID = null;
  }

  /* ==========================================================================
   * TOOLTIPS
   * ======================================================================== */

  loadTooltips(): void {
    this.translateService
      .stream('order-by.most-compact')
      .subscribe(value => {
        const tooltip = $('#compact-tooltip');
        tooltip.attr('title', value);
        tooltip.tooltip('dispose');
        tooltip.tooltip();
      });

    this.translateService
      .stream('order-by.most-balanced')
      .subscribe(value => {
        const tooltip = $('#balanced-tooltip');
        tooltip.attr('title', value);
        tooltip.tooltip('dispose');
        tooltip.tooltip();
      });

    this.translateService
      .stream('order-by.most-free-days')
      .subscribe(value => {
        const tooltip = $('#free-days-tooltip');
        tooltip.attr('title', value);
        tooltip.tooltip('dispose');
        tooltip.tooltip();
      });
  }

  /* ==========================================================================
   * SORTING
   * ======================================================================== */

  pickViewOption(option: string): void {
    this.spinners.sorting = true;

    switch (option) {
      case 'balanced':
        this.generatedSchedules = this.stateService.hasSchedulesSortedByMostBalanced() ?
          [...this.stateService.schedulesSortedByMostBalanced] :
          this.generationService.sortByMostBalanced(this.generatedSchedules);
        break;

      case 'free-days':
        this.generatedSchedules = this.stateService.hasSchedulesSortedByMostFreeDays() ?
          [...this.stateService.schedulesSortedByMostFreeDays] :
          this.generationService.sortByMostFreeDays(this.generatedSchedules);

        if (this.generatedSchedules.length > 0) {
          const firstInfo = this.generationService.generatedSchedulesInfo.get(
            this.generatedSchedules[0].id
          );

          if (firstInfo && firstInfo.nr_free_days === 0) {
            this.translateService.currentLang === 'pt-PT' ?
              this.alertService.showAlert(
                'Atenção',
                'Não existe nenhum horário com dias livres',
                'warning'
              ) :
              this.alertService.showAlert(
                'Attention',
                'There is no schedule with free days',
                'warning'
              );
          }
        }
        break;

      case 'compact':
      default:
        this.generatedSchedules = this.stateService.hasSchedulesSortedByMostCompact() ?
          [...this.stateService.schedulesSortedByMostCompact] :
          this.generationService.sortByMostCompact(this.generatedSchedules);
        break;
    }

    if (this.generatedSchedules[0]) {
      this.scheduleInViewID = this.generatedSchedules[0].id;
    }

    this.spinners.sorting = false;
    this.logger.log('Changed view to ' + option);
  }

  /* ==========================================================================
   * EXCLUDED SHIFTS / TIMEFRAMES
   * ======================================================================== */

  removeExcludedShift(shiftName: string): void {
    this.excludedShiftsSubject.next(
      this.excludedShifts.filter(name => name !== shiftName)
    );
  }

  removeExcludedTimeframe(timeframe: Lesson): void {
    this.excludedTimeframesSubject.next(
      this.excludedTimeframes.filter(tf => !tf.equal(timeframe))
    );
  }

  /* ==========================================================================
   * PICKED SCHEDULES
   * ======================================================================== */

  addSchedule(scheduleID: number): void {
    const scheduleIndex = this.findScheduleIndex(
      scheduleID,
      this.generatedSchedules
    );

    if (scheduleIndex === undefined || scheduleIndex < 0) {
      return;
    }

    const scheduleToAdd = this.generatedSchedules[scheduleIndex];

    if (!this.schedulesPicked.includes(scheduleToAdd)) {
      this.schedulesPicked.push(scheduleToAdd);
    } else {
      this.translateService.currentLang === 'pt-PT' ?
        this.alertService.showAlert(
          'Atenção',
          'Este horário já foi adicionado!',
          'warning'
        ) :
        this.alertService.showAlert(
          'Attention',
          'Schedule already added!',
          'warning'
        );
    }

    this.logger.log('schedules picked', this.schedulesPicked);
  }

  removeSchedule(scheduleID: number): void {
    const scheduleIndex = this.findScheduleIndex(
      scheduleID,
      this.generatedSchedules
    );

    if (scheduleIndex === undefined || scheduleIndex < 0) {
      return;
    }

    const scheduleToRemove = this.generatedSchedules[scheduleIndex];

    if (this.schedulesPicked.includes(scheduleToRemove)) {
      this.schedulesPicked.splice(
        this.schedulesPicked.indexOf(scheduleToRemove),
        1
      );
    }

    this.logger.log('schedules picked', this.schedulesPicked);
  }

  /* ==========================================================================
   * SAVE
   * ======================================================================== */

  save(): void {
    this.pdfService.generateSchedulesPdf(
      this.schedulesPicked,
      this.eventColors
    );

    this.logger.log('PDF generated');
  }

  /* ==========================================================================
   * HELPERS
   * ======================================================================== */

  findScheduleIndex(scheduleID: number, schedules: Schedule[]): number | undefined {
    for (let i = 0; i < schedules.length; i++) {
      if (schedules[i].id === scheduleID) {
        return i;
      }
    }
    return undefined;
  }

  goBack(): void {
    this.router.navigate(['/']);
  }

  onKeyDownArrowRight(): void {
    this.keyDownSubject.next('right');
  }

  onKeyDownArrowLeft(): void {
    this.keyDownSubject.next('left');
  }

  capitalize(s: string): string {
    if (!s) return '';
    return s[0].toUpperCase() + s.substring(1);
  }

  numberWithCommas(x: number): string {
    return numberWithCommas(x);
  }

  getTimeframeLabel(timeframe: Lesson): string {
    return (
      getMinifiedWeekday(
        timeframe.start.getDay(),
        this.translateService.currentLang
      ) +
      ' ' +
      formatTime(timeframe.start) +
      ' -> ' +
      formatTime(timeframe.end)
    );
  }

  scrollTo(elementID: string): void {
    const element = $('#' + elementID);
    const position = element.offset().top;

    document.documentElement.scrollTop = document.body.scrollTop = position;
  }

  /* ==========================================================================
   * WINDOW EVENTS
   * ======================================================================== */

  @HostListener('window:resize', [])
  onWindowResize(): void {
    this.mobileView = window.innerWidth <= 991.98;
  }

  @HostListener('window:popstate', [])
  onPopState(): void {
    this.goBack();
  }
}