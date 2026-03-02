import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ExcelViewer } from './excel-viewer';

describe('ExcelViewer', () => {
  let component: ExcelViewer;
  let fixture: ComponentFixture<ExcelViewer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExcelViewer],
    }).compileComponents();

    fixture = TestBed.createComponent(ExcelViewer);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
