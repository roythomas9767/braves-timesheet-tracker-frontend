import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AutomationPanel } from './automation-panel';

describe('AutomationPanel', () => {
  let component: AutomationPanel;
  let fixture: ComponentFixture<AutomationPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AutomationPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(AutomationPanel);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
