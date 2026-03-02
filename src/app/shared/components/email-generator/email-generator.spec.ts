import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EmailGenerator } from './email-generator';

describe('EmailGenerator', () => {
  let component: EmailGenerator;
  let fixture: ComponentFixture<EmailGenerator>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmailGenerator],
    }).compileComponents();

    fixture = TestBed.createComponent(EmailGenerator);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
